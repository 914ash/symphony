import { SymphonyError } from "./errors.js";
import { renderPrompt } from "./template.js";
import type { AppServerClient, AgentEvent } from "./app-server.js";
import { executeLinearGraphqlTool } from "./dynamic-tools/linear-graphql.js";
import type { Issue, Logger, ServiceConfig, WorkerResult, WorkerExitReason, VerificationRecord } from "./types.js";
import type { TrackerAdapter } from "./tracker.js";
import type { WorkspaceManager } from "./workspace.js";

interface RunWorkerParams {
  issue: Issue;
  attempt: number | null;
  config: ServiceConfig;
  promptTemplate: string;
  tracker: TrackerAdapter;
  workspaceManager: WorkspaceManager;
  appServerClient: AppServerClient;
  logger: Logger;
  onEvent: (event: AgentEvent) => void;
  onRegisterCancel: (fn: (reason: string) => void) => void;
}

function continuationGuidance(issue: Issue): string {
  return [
    `Continue working on issue ${issue.identifier}.`,
    "Do not restate the entire plan; focus on the next concrete steps.",
    "Stop once the current incremental task is complete and summarize remaining work."
  ].join("\n");
}

export async function runWorkerAttempt(params: RunWorkerParams): Promise<WorkerResult> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  const workspace = await params.workspaceManager.createForIssue(params.issue.identifier);
  await params.workspaceManager.runBeforeRun(workspace.workspacePath);

  const initialPrompt = await renderPrompt(params.promptTemplate, params.issue, params.attempt);
  const title = `${params.issue.identifier}: ${params.issue.title}`;

  const session = await params.appServerClient.startSession({
    workspacePath: workspace.workspacePath,
    initialPrompt,
    title,
    onEvent: params.onEvent,
    tools: params.config.codex.enableLinearGraphqlTool
      ? [
          {
            name: "linear_graphql",
            description: "Execute one raw GraphQL operation against Linear using Symphony auth.",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string" },
                variables: { type: "object", additionalProperties: true }
              },
              required: ["query"],
              additionalProperties: false
            }
          }
        ]
      : [],
    onToolCall: async (name, input) => {
      if (!params.config.codex.enableLinearGraphqlTool || name !== "linear_graphql") {
        return { success: false, error: "unsupported_tool_call" };
      }
      return executeLinearGraphqlTool(input, {
        endpoint: params.config.tracker.endpoint,
        apiKey: params.config.tracker.apiKey,
        timeoutMs: 30_000
      });
    }
  });

  const abortController = new AbortController();
  params.onRegisterCancel((reason: string) => {
    params.logger.warn("worker_cancel_requested", {
      issue_id: params.issue.id,
      issue_identifier: params.issue.identifier,
      reason
    });
    abortController.abort();
  });

  let turnsExecuted = 0;
  let currentIssue = params.issue;
  const sessionIdPrefix = session.threadId;
  let lastTurnId: string | null = null;
  let exitReason: WorkerExitReason = "normal";

  try {
    for (let turnNumber = 1; turnNumber <= params.config.agent.maxTurns; turnNumber += 1) {
      const prompt =
        turnNumber === 1 ? initialPrompt : `${continuationGuidance(currentIssue)}\nAttempt: ${params.attempt ?? 1}`;
      const turn = await session.runTurn({
        prompt,
        title,
        onEvent: params.onEvent,
        signal: abortController.signal
      });
      lastTurnId = turn.turnId;
      turnsExecuted += 1;

      const refreshed = await params.tracker.fetchIssueStatesByIds([currentIssue.id]);
      const updated = refreshed[0];
      if (updated) {
        currentIssue = { ...currentIssue, state: updated.state };
      }

      const activeSet = new Set(params.config.tracker.activeStates.map((state) => state.toLowerCase()));
      if (!activeSet.has(currentIssue.state.toLowerCase())) {
        exitReason = "state_changed";
        break;
      }

      if (turnNumber === params.config.agent.maxTurns) {
        exitReason = "max_turns";
      }
    }

    const finishedAt = new Date().toISOString();
    return {
      turnsExecuted,
      sessionId: `${sessionIdPrefix}-${lastTurnId ?? "unknown"}`,
      startedAt,
      finishedAt,
      durationMs: Date.now() - startTime,
      exitReason,
      verifications: []
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    let finalExitReason: WorkerExitReason = "failed";

    if (abortController.signal.aborted) {
      finalExitReason = "cancelled";
    }

    if (error instanceof SymphonyError) {
      throw error;
    }
    throw new SymphonyError("worker_failed", "worker attempt failed", error);
  } finally {
    await session.stop();
    await params.workspaceManager.runAfterRun(workspace.workspacePath);
  }
}
