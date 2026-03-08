import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as worker from "../../src/worker.js";
import { resolveConfig } from "../../src/config.js";
import { createLogger } from "../../src/logger.js";
import { Orchestrator } from "../../src/orchestrator.js";
import type { Issue, WorkflowDefinition } from "../../src/types.js";
import { WorkspaceManager } from "../../src/workspace.js";
import { runWorkerAttempt } from "../../src/worker.js";
import type { Logger, ServiceConfig } from "../../src/types.js";

const NOOP_LOGGER: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
};

function makeConfig(maxTurns: number): ServiceConfig {
  return {
    tracker: {
      kind: "linear",
      endpoint: "https://api.linear.app/graphql",
      apiKey: "test-key",
      projectSlug: "test-project",
      activeStates: ["Todo", "In Progress"],
      terminalStates: ["Done", "Cancelled"]
    },
    polling: { intervalMs: 60_000 },
    workspace: { root: process.cwd() },
    hooks: {
      afterCreate: null,
      beforeRun: null,
      afterRun: null,
      beforeRemove: null,
      timeoutMs: 60_000
    },
    agent: {
      maxConcurrentAgents: 1,
      maxTurns,
      maxRetryBackoffMs: 300_000,
      maxConcurrentAgentsByState: {}
    },
    codex: {
      command: "codex app-server",
      launchMode: "strict",
      approvalPolicy: "full-auto",
      threadSandbox: "workspace-write",
      turnSandboxPolicy: "workspace-write",
      enableLinearGraphqlTool: false,
      turnTimeoutMs: 60_000,
      readTimeoutMs: 5_000,
      stallTimeoutMs: 300_000
    },
    server: { port: null }
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for condition");
}

describe("conformance: session and turn count", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("formats session_id as <thread>-<turn> at completion", async () => {
    const issue: Issue = {
      id: "issue-1",
      identifier: "SYM-1",
      title: "Test issue",
      state: "Todo",
      labels: [],
      blockedBy: []
    };

    const runTurn = vi
      .fn<() => Promise<{ turnId: string }>>()
      .mockResolvedValueOnce({ turnId: "turn-1" })
      .mockResolvedValueOnce({ turnId: "turn-2" });

    const stop = vi.fn<() => Promise<void>>().mockResolvedValue();
    const result = await runWorkerAttempt({
      issue,
      attempt: 3,
      config: makeConfig(2),
      promptTemplate: "Work issue {{ issue.identifier }}",
      tracker: {
        fetchCandidateIssues: async () => [],
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => [{ id: issue.id, identifier: issue.identifier, state: issue.state }]
      },
      workspaceManager: {
        createForIssue: async () => ({ workspaceKey: "SYM-1", workspacePath: process.cwd() }),
        runBeforeRun: async () => {},
        runAfterRun: async () => {}
      } as any,
      appServerClient: {
        startSession: async () => ({
          threadId: "thread-abc",
          runTurn,
          stop
        })
      } as any,
      logger: NOOP_LOGGER,
      onEvent: () => {},
      onRegisterCancel: () => {}
    });

    expect(result.turnsExecuted).toBe(2);
    expect(result.sessionId).toBe("thread-abc-turn-2");
    // @ts-ignore - testing new fields
    expect(result.startedAt).toBeDefined();
    // @ts-ignore
    expect(result.finishedAt).toBeDefined();
    // @ts-ignore
    expect(result.durationMs).toBeGreaterThan(0);
    // @ts-ignore
    expect(result.exitReason).toBe("max_turns");
    // @ts-ignore
    expect(Array.isArray(result.verifications)).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("tracks executed turns instead of retry attempt count in state snapshot", async () => {
    const deferred = Promise.withResolvers<{ turnsExecuted: number; sessionId: string }>();
    const mockAttempt = vi
      .spyOn(worker, "runWorkerAttempt")
      .mockImplementation(async (params) => {
        params.onEvent({ event: "turn_completed", timestamp: new Date().toISOString() });
        params.onEvent({ event: "turn_completed", timestamp: new Date().toISOString() });
        return deferred.promise;
      });

    const config = resolveConfig({
      tracker: {
        kind: "linear",
        api_key: "test-key",
        project_slug: "test-project",
        active_states: ["Todo", "In Progress"],
        terminal_states: ["Done", "Cancelled"]
      },
      polling: { interval_ms: 60_000 },
      agent: { max_concurrent_agents: 1, max_turns: 5 }
    });

    const issue: Issue = {
      id: "issue-1",
      identifier: "SYM-1",
      title: "Test turn counting",
      state: "Todo",
      labels: [],
      blockedBy: []
    };

    const workflow: WorkflowDefinition = {
      path: "WORKFLOW.md",
      config: {},
      promptTemplate: "Work on {{ issue.identifier }}"
    };

    const tracker = {
      fetchCandidateIssues: async () => [issue],
      fetchIssuesByStates: async () => [],
      fetchIssueStatesByIds: async () => [{ id: issue.id, identifier: issue.identifier, state: issue.state }]
    };

    const root = await mkdtemp(path.join(os.tmpdir(), "symphony-conformance-"));
    const workspaceManager = new WorkspaceManager(
      { root },
      {
        afterCreate: null,
        beforeRun: null,
        afterRun: null,
        beforeRemove: null,
        timeoutMs: 60_000
      },
      createLogger("error")
    );

    const orchestrator = new Orchestrator({
      logger: createLogger("error"),
      tracker: tracker as any,
      config,
      workflow,
      workspaceManager
    });

    await orchestrator.start();
    try {
      await waitFor(() => orchestrator.getStateSnapshot().running.length === 1);
      const running = orchestrator.getStateSnapshot().running[0];
      expect(running.issue_identifier).toBe(issue.identifier);
      expect(running.turn_count).toBe(2);
      expect(mockAttempt).toHaveBeenCalledTimes(1);
    } finally {
      deferred.resolve({ turnsExecuted: 2, sessionId: "thread-1-turn-2" });
      await waitFor(() => orchestrator.getStateSnapshot().running.length === 0).catch(() => undefined);
      await orchestrator.stop();
    }
  });

  it("emits lifecycle logs with issue_id, issue_identifier, and session_id context", async () => {
    const completion = Promise.withResolvers<{ turnsExecuted: number; sessionId: string }>();
    const issue: Issue = {
      id: "issue-log-1",
      identifier: "SYM-LOG",
      title: "Log contract",
      state: "Todo",
      labels: [],
      blockedBy: []
    };

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };

    const workflow: WorkflowDefinition = {
      path: "WORKFLOW.md",
      config: {},
      promptTemplate: "Work on {{ issue.identifier }}"
    };

    vi.spyOn(worker, "runWorkerAttempt").mockImplementation(async (params) => {
      params.onEvent({ event: "session_started", message: "thread-log" });
      params.onEvent({ event: "turn_completed", turn_id: "turn-1", timestamp: new Date().toISOString() });
      params.onEvent({ event: "turn_failed", turn_id: "turn-1", timestamp: new Date().toISOString(), error_code: "tool_error" });
      return completion.promise;
    });

    const config = resolveConfig({
      tracker: {
        kind: "linear",
        api_key: "test-key",
        project_slug: "test-project",
        active_states: ["Todo", "In Progress"],
        terminal_states: ["Done", "Cancelled"]
      },
      polling: { interval_ms: 60_000 },
      agent: { max_concurrent_agents: 1, max_turns: 2 }
    });

    const tracker = {
      fetchCandidateIssues: async () => [issue],
      fetchIssuesByStates: async () => [],
      fetchIssueStatesByIds: async () => [{ id: issue.id, identifier: issue.identifier, state: issue.state }]
    };

    const root = await mkdtemp(path.join(os.tmpdir(), "symphony-conformance-"));
    const workspaceManager = new WorkspaceManager(
      { root },
      {
        afterCreate: null,
        beforeRun: null,
        afterRun: null,
        beforeRemove: null,
        timeoutMs: 60_000
      },
      createLogger("error")
    );

    const orchestrator = new Orchestrator({
      logger: logger as unknown as Logger,
      tracker: tracker as any,
      config,
      workflow,
      workspaceManager
    });

    await orchestrator.start();
    try {
      await waitFor(() => logger.info.mock.calls.some(([event]) => event === "session_started"));
      expect(logger.info).toHaveBeenCalledWith(
        "session_started",
        expect.objectContaining({
          issue_id: issue.id,
          issue_identifier: issue.identifier,
          session_id: "thread-log"
        })
      );
      expect(logger.info).toHaveBeenCalledWith(
        "turn_completed",
        expect.objectContaining({
          issue_id: issue.id,
          issue_identifier: issue.identifier,
          session_id: "thread-log-turn-1"
        })
      );
      expect(logger.error).toHaveBeenCalledWith(
        "turn_failed",
        expect.objectContaining({
          issue_id: issue.id,
          issue_identifier: issue.identifier,
          session_id: "thread-log-turn-1",
          error_code: "tool_error"
        })
      );
    } finally {
      completion.resolve({ turnsExecuted: 1, sessionId: "thread-log-turn-1" });
      await waitFor(() => orchestrator.getStateSnapshot().running.length === 0).catch(() => undefined);
      await orchestrator.stop();
    }
  });
});
