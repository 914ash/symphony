import { describe, expect, it, vi } from "vitest";
import { runWorkerAttempt } from "../../src/worker.js";
import type { Issue, Logger, ServiceConfig } from "../../src/types.js";

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

describe("conformance: session_id", () => {
  it("includes both thread and turn when max turns are reached", async () => {
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
        fetchIssueStatesByIds: async () => [
          {
            id: issue.id,
            identifier: issue.identifier,
            state: issue.state
          }
        ]
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
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
