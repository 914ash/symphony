import { AppServerClient, type AgentEvent } from "./app-server.js";
import { validateDispatchConfig } from "./config.js";
import { asSymphonyError } from "./errors.js";
import { retryDelayMs, shouldDispatchIssue, sortIssuesForDispatch } from "./scheduling.js";
import type { TrackerAdapter } from "./tracker.js";
import type { Issue, Logger, RetryEntry, RuntimeState, RunningEntry, ServiceConfig, WorkflowDefinition, WorkerResult } from "./types.js";
import { runWorkerAttempt } from "./worker.js";
import { WorkspaceManager } from "./workspace.js";

interface SnapshotIssueRow {
  issue_id: string;
  issue_identifier: string;
  state: string;
  session_id: string | null;
  turn_count: number;
  last_event: string | null;
  last_message: string | null;
  started_at: string;
  last_event_at: string | null;
  tokens: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  writeback_status?: import("./types.js").WritebackStatus;
  verification_summary?: string;
  duration_ms?: number;
}

export class Orchestrator {
  readonly #logger: Logger;
  readonly #tracker: TrackerAdapter;
  #config: ServiceConfig;
  #workflow: WorkflowDefinition;
  #workspaceManager: WorkspaceManager;

  #state: RuntimeState = {
    running: new Map(),
    claimed: new Set(),
    retryAttempts: new Map(),
    completed: new Set(),
    codexTotals: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      secondsRunning: 0
    },
    codexRateLimits: null,
    globalEvents: []
  };

  #tickTimer: NodeJS.Timeout | null = null;
  #tickInProgress = false;
  #stopped = true;
  #refreshRequested = false;

  constructor(params: {
    logger: Logger;
    tracker: TrackerAdapter;
    config: ServiceConfig;
    workflow: WorkflowDefinition;
    workspaceManager: WorkspaceManager;
  }) {
    this.#logger = params.logger;
    this.#tracker = params.tracker;
    this.#config = params.config;
    this.#workflow = params.workflow;
    this.#workspaceManager = params.workspaceManager;
  }

  get config(): ServiceConfig {
    return this.#config;
  }

  applyWorkflow(workflow: WorkflowDefinition, config: ServiceConfig): void {
    this.#workflow = workflow;
    this.#config = config;
    this.#workspaceManager = new WorkspaceManager(config.workspace, config.hooks, this.#logger);
    this.#logger.info("workflow_reloaded");
  }

  async startupTerminalWorkspaceCleanup(): Promise<void> {
    try {
      const terminalIssues = await this.#tracker.fetchIssuesByStates(this.#config.tracker.terminalStates);
      for (const issue of terminalIssues) {
        await this.#workspaceManager.removeWorkspace(issue.identifier);
      }
      this.#logger.info("startup_terminal_workspace_cleanup_completed", { count: terminalIssues.length });
    } catch (error) {
      this.#logger.warn("startup_terminal_workspace_cleanup_failed", { error: String(error) });
    }
  }

  async start(): Promise<void> {
    this.#stopped = false;
    this.#scheduleTick(0);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#tickTimer) {
      clearTimeout(this.#tickTimer);
      this.#tickTimer = null;
    }
    for (const entry of this.#state.running.values()) {
      entry.cancel?.("service_stop");
    }
    for (const entry of this.#state.retryAttempts.values()) {
      clearTimeout(entry.timer);
    }
    this.#state.retryAttempts.clear();
  }

  requestRefresh(): { queued: boolean; coalesced: boolean; requestedAt: string } {
    const alreadyQueued = this.#refreshRequested;
    this.#refreshRequested = true;
    this.#scheduleTick(0);
    return { queued: true, coalesced: alreadyQueued, requestedAt: new Date().toISOString() };
  }

  #scheduleTick(delayMs: number): void {
    if (this.#stopped) {
      return;
    }
    if (this.#tickTimer) {
      clearTimeout(this.#tickTimer);
    }
    this.#tickTimer = setTimeout(() => {
      void this.tick();
    }, Math.max(delayMs, 0));
  }

  async tick(): Promise<void> {
    if (this.#stopped || this.#tickInProgress) {
      return;
    }

    this.#tickInProgress = true;
    this.#refreshRequested = false;
    try {
      await this.#reconcileRunningIssues();
      try {
        validateDispatchConfig(this.#config);
      } catch (error) {
        this.#logger.error("dispatch_preflight_validation_failed", { error: String(error) });
        return;
      }

      const candidates = await this.#tracker.fetchCandidateIssues();
      for (const issue of sortIssuesForDispatch(candidates)) {
        if (!shouldDispatchIssue(issue, this.#config, this.#state)) {
          continue;
        }
        await this.#dispatchIssue(issue, null);
      }
    } catch (error) {
      this.#logger.error("poll_tick_failed", { error: String(error) });
    } finally {
      this.#tickInProgress = false;
      const next = this.#refreshRequested ? 0 : this.#config.polling.intervalMs;
      this.#scheduleTick(next);
    }
  }

  async #dispatchIssue(issue: Issue, attempt: number | null): Promise<void> {
    this.#state.claimed.add(issue.id);
    const runningEntry: RunningEntry = {
      issue,
      issueIdentifier: issue.identifier,
      retryAttempt: attempt ?? 0,
      turnCount: 0,
      startedAt: new Date().toISOString(),
      lastCodexTimestamp: null,
      lastCodexEvent: null,
      lastCodexMessage: null,
      threadId: null,
      sessionId: null,
      lastTurnId: null,
      codexAppServerPid: null,
      codexInputTokens: 0,
      codexOutputTokens: 0,
      codexTotalTokens: 0,
      lastReportedInputTokens: 0,
      lastReportedOutputTokens: 0,
      lastReportedTotalTokens: 0,
      recentEvents: []
    };
    this.#state.running.set(issue.id, runningEntry);
    const appServerClient = new AppServerClient(this.#config.codex, this.#logger);

    void (async () => {
      let workerResult: WorkerResult | null = null;
      try {
        workerResult = await runWorkerAttempt({
          issue,
          attempt,
          config: this.#config,
          promptTemplate: this.#workflow.promptTemplate,
          tracker: this.#tracker,
          workspaceManager: this.#workspaceManager,
          appServerClient,
          logger: this.#logger,
          onEvent: (event) => this.#handleCodexEvent(issue.id, event),
          onRegisterCancel: (cancel) => {
            const entry = this.#state.running.get(issue.id);
            if (entry) {
              entry.cancel = cancel;
            }
          }
        });

        const entry = this.#state.running.get(issue.id);
        if (entry) {
          entry.sessionId = workerResult.sessionId;
          entry.turnCount = Math.max(entry.turnCount, workerResult.turnsExecuted);
          entry.lastWorkerResult = workerResult;
        }
      } catch (error) {
        const se = asSymphonyError(error, "worker_failed");
        const entry = this.#state.running.get(issue.id);
        this.#logger.error("worker_failed", {
          issue_id: issue.id,
          issue_identifier: issue.identifier,
          session_id: entry?.sessionId ?? entry?.threadId ?? null,
          error_code: se.code,
          error_message: se.message
        });
      } finally {
        this.#onWorkerExit(issue.id, workerResult);
      }
    })();
  }

  #handleCodexEvent(issueId: string, event: AgentEvent): void {
    const entry = this.#state.running.get(issueId);
    if (!entry) {
      return;
    }
    if (event.event === "session_started" && event.message) {
      entry.threadId = event.message;
    }
    if (event.turn_id) {
      entry.lastTurnId = event.turn_id;
      if (entry.threadId) {
        entry.sessionId = `${entry.threadId}-${event.turn_id}`;
      }
    }
    if (event.event === "turn_completed") {
      entry.turnCount += 1;
    }

    entry.lastCodexTimestamp = event.timestamp ?? new Date().toISOString();
    entry.lastCodexEvent = event.event;
    
    // Synthesize message if missing
    let message = event.message ?? null;
    if (!message) {
      if (event.event === "turn_completed") {
        message = `Completed turn #${entry.turnCount}`;
      } else if (event.event === "turn_started") {
        message = `Starting turn #${entry.turnCount + 1}...`;
      } else if (event.event === "session_started") {
        message = "Session started";
      }
    }

    if (message) {
      entry.lastCodexMessage = message;
    }

    const eventEntry = {
      at: entry.lastCodexTimestamp,
      event: event.event,
      message: message
    };

    entry.recentEvents.push(eventEntry);
    if (entry.recentEvents.length > 50) {
      entry.recentEvents.shift();
    }

    // Global activity feed
    this.#state.globalEvents.push({
      ...eventEntry,
      message: message ?? event.event,
      issue_identifier: entry.issueIdentifier
    });
    if (this.#state.globalEvents.length > 50) {
      this.#state.globalEvents.shift();
    }

    if (event.event === "session_started") {
      this.#logger.info("session_started", {
        issue_id: issueId,
        issue_identifier: entry.issueIdentifier,
        session_id: entry.sessionId ?? entry.threadId
      });
      return;
    }

    if (event.event === "turn_completed") {
      this.#logger.info("turn_completed", {
        issue_id: issueId,
        issue_identifier: entry.issueIdentifier,
        session_id: entry.sessionId ?? entry.threadId
      });
      return;
    }

    if (event.event === "turn_failed") {
      this.#logger.error("turn_failed", {
        issue_id: issueId,
        issue_identifier: entry.issueIdentifier,
        session_id: entry.sessionId ?? entry.threadId,
        error_code: event.error_code
      });
      return;
    }

    if (event.event.startsWith("turn_")) {
      this.#logger.info("session_event", {
        issue_id: issueId,
        issue_identifier: entry.issueIdentifier,
        session_id: entry.sessionId ?? entry.threadId,
        event: event.event
      });
    }
    if (event.usage) {
      const absInput = event.usage.input_tokens ?? entry.lastReportedInputTokens;
      const absOutput = event.usage.output_tokens ?? entry.lastReportedOutputTokens;
      const absTotal = event.usage.total_tokens ?? entry.lastReportedTotalTokens;

      const deltaInput = Math.max(absInput - entry.lastReportedInputTokens, 0);
      const deltaOutput = Math.max(absOutput - entry.lastReportedOutputTokens, 0);
      const deltaTotal = Math.max(absTotal - entry.lastReportedTotalTokens, 0);

      entry.codexInputTokens = absInput;
      entry.codexOutputTokens = absOutput;
      entry.codexTotalTokens = absTotal;
      entry.lastReportedInputTokens = absInput;
      entry.lastReportedOutputTokens = absOutput;
      entry.lastReportedTotalTokens = absTotal;

      this.#state.codexTotals.inputTokens += deltaInput;
      this.#state.codexTotals.outputTokens += deltaOutput;
      this.#state.codexTotals.totalTokens += deltaTotal;
    }
    if (event.rate_limits !== undefined) {
      this.#state.codexRateLimits = event.rate_limits;
    }
  }

  #onWorkerExit(issueId: string, result: WorkerResult | null): void {
    const running = this.#state.running.get(issueId);
    if (!running) {
      return;
    }
    this.#state.running.delete(issueId);
    const runtimeSeconds = (Date.now() - new Date(running.startedAt).getTime()) / 1000;
    this.#state.codexTotals.secondsRunning += Math.max(runtimeSeconds, 0);
    this.#state.claimed.delete(issueId);

    const exitReason = result?.exitReason ?? "failed";

    if (exitReason === "normal" || exitReason === "state_changed" || exitReason === "max_turns") {
      this.#state.completed.add(issueId);

      if (this.#config.tracker.writeback.enabled && result && exitReason === "normal") {
        void this.#performWriteback(issueId, running, result);
      } else {
        this.#scheduleRetry(issueId, running.issueIdentifier, 1, true);
      }
      return;
    }

    if (exitReason === "cancelled") {
      return;
    }

    const nextAttempt = Math.max(running.retryAttempt + 1, 1);
    this.#scheduleRetry(issueId, running.issueIdentifier, nextAttempt, false, `worker exited: ${exitReason}`);
  }

  async #performWriteback(issueId: string, entry: RunningEntry, result: WorkerResult): Promise<void> {
    const isEligible = await this.#checkEligibility(entry, result);
    if (!isEligible) {
      entry.writebackStatus = "skipped";
      this.#logger.info("writeback_skipped_not_eligible", { issueId });
      this.#scheduleRetry(issueId, entry.issueIdentifier, 1, true);
      return;
    }

    entry.writebackStatus = "in_progress";
    try {
      const comment = this.#formatCompletionComment(result);
      await this.#tracker.createIssueComment(issueId, comment);
      entry.writebackStatus = "partial";

      const doneState = this.#config.tracker.writeback.doneState;
      if (doneState) {
        await this.#tracker.markIssueCompleted(issueId, doneState);
      }
      entry.writebackStatus = "completed";
      this.#logger.info("writeback_completed", { issueId });
    } catch (error) {
      entry.writebackStatus = "failed";
      entry.writebackError = String(error);
      this.#logger.error("writeback_failed", { issueId, error: String(error) });
      this.#scheduleRetry(issueId, entry.issueIdentifier, 1, true, `writeback failed: ${String(error)}`);
    }
  }

  async #checkEligibility(entry: RunningEntry, result: WorkerResult): Promise<boolean> {
    const required = this.#config.verification.requiredKinds;
    const records = result.verifications ?? [];

    for (const kind of required) {
      const record = records.find((r) => r.kind === kind);
      if (!record || !record.passed) {
        return false;
      }
    }

    const signals = this.#config.verification.workspaceSignals;
    if (signals.length > 0) {
      const workspacePath = this.#workspaceManager.getWorkspacePath(entry.issueIdentifier);
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      for (const signal of signals) {
        try {
          await fs.access(path.join(workspacePath, signal));
        } catch {
          return false;
        }
      }
    }

    return true;
  }

  #formatCompletionComment(result: WorkerResult): string {
    const lines = [
      "### Symphony Task Completion Summary",
      `- **Session ID:** \`${result.sessionId}\``,
      `- **Turns:** ${result.turnsExecuted}`,
      `- **Duration:** ${Math.floor(result.durationMs / 1000)}s`,
      ""
    ];

    if (result.verifications.length > 0) {
      lines.push("#### Verifications");
      for (const v of result.verifications) {
        lines.push(`- [${v.passed ? "x" : " "}] **${v.kind}**: ${v.passed ? "PASS" : "FAIL"}`);
      }
      lines.push("");
    }

    lines.push("Task completed automatically based on verification evidence.");
    return lines.join("\n");
  }

  #scheduleRetry(issueId: string, issueIdentifier: string, attempt: number, continuation: boolean, error?: string): void {
    const existing = this.#state.retryAttempts.get(issueId);
    if (existing) {
      clearTimeout(existing.timer);
      this.#state.retryAttempts.delete(issueId);
    }

    const delayMs = retryDelayMs(attempt, continuation, this.#config.agent.maxRetryBackoffMs);
    const dueAtMs = Date.now() + delayMs;
    const timer = setTimeout(() => {
      void this.#onRetryTimer(issueId);
    }, delayMs);
    const entry: RetryEntry = { issueId, issueIdentifier, attempt, dueAtMs, error, timer };
    this.#state.retryAttempts.set(issueId, entry);
    this.#logger.info("retry_scheduled", {
      issue_id: issueId,
      issue_identifier: issueIdentifier,
      attempt,
      due_at: new Date(dueAtMs).toISOString(),
      error
    });
  }

  async #onRetryTimer(issueId: string): Promise<void> {
    const retry = this.#state.retryAttempts.get(issueId);
    if (!retry) {
      return;
    }
    this.#state.retryAttempts.delete(issueId);

    try {
      const candidates = await this.#tracker.fetchCandidateIssues();
      const issue = candidates.find((candidate) => candidate.id === issueId);
      if (!issue) {
        this.#state.claimed.delete(issueId);
        return;
      }

      if (!shouldDispatchIssue(issue, this.#config, this.#state)) {
        this.#scheduleRetry(issue.id, issue.identifier, retry.attempt + 1, false, "no available orchestrator slots");
        return;
      }

      await this.#dispatchIssue(issue, retry.attempt);
    } catch (error) {
      this.#logger.error("retry_tick_failed", { issue_id: issueId, error: String(error) });
      this.#scheduleRetry(issueId, retry.issueIdentifier, retry.attempt + 1, false, "retry poll failed");
    }
  }

  async #reconcileRunningIssues(): Promise<void> {
    if (this.#state.running.size === 0) {
      return;
    }

    // Part A: stall detection.
    if (this.#config.codex.stallTimeoutMs > 0) {
      for (const [issueId, entry] of this.#state.running.entries()) {
        const baseline = entry.lastCodexTimestamp ?? entry.startedAt;
        const elapsedMs = Date.now() - new Date(baseline).getTime();
        if (elapsedMs > this.#config.codex.stallTimeoutMs) {
          entry.cancel?.("stall_timeout");
          this.#onWorkerExit(issueId, null);
        }
      }
    }

    const runningIds = [...this.#state.running.keys()];
    if (runningIds.length === 0) {
      return;
    }

    try {
      const refresh = await this.#tracker.fetchIssueStatesByIds(runningIds);
      const byId = new Map(refresh.map((item) => [item.id, item]));
      const active = new Set(this.#config.tracker.activeStates.map((state) => state.toLowerCase()));
      const terminal = new Set(this.#config.tracker.terminalStates.map((state) => state.toLowerCase()));

      for (const issueId of runningIds) {
        const row = this.#state.running.get(issueId);
        if (!row) {
          continue;
        }
        const refreshed = byId.get(issueId);
        if (!refreshed) {
          continue;
        }

        row.issue = { ...row.issue, state: refreshed.state };
        const stateName = refreshed.state.toLowerCase();
        if (terminal.has(stateName)) {
          row.cancel?.("terminal_state");
          await this.#workspaceManager.removeWorkspace(row.issueIdentifier);
          this.#onWorkerExit(issueId, null);
          continue;
        }

        if (!active.has(stateName)) {
          row.cancel?.("non_active_state");
          this.#onWorkerExit(issueId, null);
        }
      }
    } catch (error) {
      this.#logger.warn("running_state_refresh_failed", { error: String(error) });
    }
  }

  getStateSnapshot(): {
    generated_at: string;
    counts: { running: number; retrying: number };
    running: SnapshotIssueRow[];
    retrying: Array<{ issue_id: string; issue_identifier: string; attempt: number; due_at: string; error?: string }>;
    global_events: Array<{ at: string; event: string; message: string; issue_identifier: string }>;
    codex_totals: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      seconds_running: number;
    };
    rate_limits: unknown;
  } {
    const now = Date.now();
    const runningRows: SnapshotIssueRow[] = [...this.#state.running.entries()].map(([issueId, entry]) => ({
      issue_id: issueId,
      issue_identifier: entry.issueIdentifier,
      state: entry.issue.state,
      session_id: entry.sessionId,
      turn_count: entry.turnCount,
      last_event: entry.lastCodexEvent,
      last_message: entry.lastCodexMessage,
      started_at: entry.startedAt,
      last_event_at: entry.lastCodexTimestamp,
      tokens: {
        input_tokens: entry.codexInputTokens,
        output_tokens: entry.codexOutputTokens,
        total_tokens: entry.codexTotalTokens
      },
      writeback_status: entry.writebackStatus,
      verification_summary: entry.lastWorkerResult
        ? `${entry.lastWorkerResult.verifications.filter((v) => v.passed).length}/${
            entry.lastWorkerResult.verifications.length
          }`
        : "0/0",
      duration_ms: entry.lastWorkerResult?.durationMs ?? Date.now() - new Date(entry.startedAt).getTime()
    }));

    const retrying = [...this.#state.retryAttempts.values()].map((entry) => ({
      issue_id: entry.issueId,
      issue_identifier: entry.issueIdentifier,
      attempt: entry.attempt,
      due_at: new Date(entry.dueAtMs).toISOString(),
      error: entry.error
    }));

    const secondsRunningActive = [...this.#state.running.values()].reduce((sum, entry) => {
      const elapsed = (now - new Date(entry.startedAt).getTime()) / 1000;
      return sum + Math.max(elapsed, 0);
    }, 0);

    return {
      generated_at: new Date().toISOString(),
      counts: {
        running: runningRows.length,
        retrying: retrying.length
      },
      running: runningRows,
      retrying,
      global_events: this.#state.globalEvents,
      codex_totals: {
        input_tokens: this.#state.codexTotals.inputTokens,
        output_tokens: this.#state.codexTotals.outputTokens,
        total_tokens: this.#state.codexTotals.totalTokens,
        seconds_running: this.#state.codexTotals.secondsRunning + secondsRunningActive
      },
      rate_limits: this.#state.codexRateLimits
    };
  }

  getIssueSnapshot(issueIdentifier: string): Record<string, unknown> | null {
    const running = [...this.#state.running.values()].find(
      (entry) => entry.issueIdentifier.toLowerCase() === issueIdentifier.toLowerCase()
    );
    const retry = [...this.#state.retryAttempts.values()].find(
      (entry) => entry.issueIdentifier.toLowerCase() === issueIdentifier.toLowerCase()
    );
    if (!running && !retry) {
      return null;
    }

    return {
      issue_identifier: issueIdentifier,
      issue_id: running?.issue.id ?? retry?.issueId ?? null,
      status: running ? "running" : "retrying",
      workspace: running ? { path: this.#workspaceManager.getWorkspacePath(running.issueIdentifier) } : null,
      attempts: {
        restart_count: running?.retryAttempt ?? 0,
        current_retry_attempt: retry?.attempt ?? null
      },
      running: running
        ? {
            session_id: running.sessionId,
            turn_count: running.turnCount,
            state: running.issue.state,
            started_at: running.startedAt,
            last_event: running.lastCodexEvent,
            last_message: running.lastCodexMessage,
            last_event_at: running.lastCodexTimestamp,
            tokens: {
              input_tokens: running.codexInputTokens,
              output_tokens: running.codexOutputTokens,
              total_tokens: running.codexTotalTokens
            }
          }
        : null,
      retry: retry
        ? {
            attempt: retry.attempt,
            due_at: new Date(retry.dueAtMs).toISOString(),
            error: retry.error
          }
        : null,
      verifications: running?.lastWorkerResult?.verifications ?? [],
      writeback_status: running?.writebackStatus ?? "pending",
      writeback_error: running?.writebackError ?? null,
      exit_reason: running?.lastWorkerResult?.exitReason ?? null,
      recent_events: running?.recentEvents ?? []
    };
  }
}
