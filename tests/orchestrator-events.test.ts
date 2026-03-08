import { beforeEach, describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { createLogger } from "../src/logger.js";
import type { Issue, ServiceConfig, WorkflowDefinition } from "../src/types.js";
import * as worker from "../src/worker.js";

vi.mock("../src/worker.js", () => ({
  runWorkerAttempt: vi.fn()
}));

const NOOP_LOGGER = createLogger("error");

async function waitFor<T>(getValue: () => T | null, timeoutMs = 2000): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = getValue();
    if (value !== null) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out");
}

describe("Orchestrator: Event Synthesis", () => {
  let config: ServiceConfig;
  let issue: Issue;
  let tracker: any;
  let workflow: WorkflowDefinition;
  let workspaceManager: any;

  beforeEach(() => {
    issue = {
      id: "issue-1",
      identifier: "SYM-1",
      title: "Test issue",
      state: "Todo",
      labels: [],
      blockedBy: []
    };

    config = {
      tracker: {
        kind: "linear",
        endpoint: "https://api.linear.app/graphql",
        apiKey: "test-key",
        projectSlug: "test-project",
        activeStates: ["Todo"],
        terminalStates: ["Done"],
        writeback: {
          enabled: false,
          doneState: null
        }
      },
      polling: { intervalMs: 60_000 },
      workspace: { root: "/tmp/symphony" },
      hooks: {
        afterCreate: null,
        beforeRun: null,
        afterRun: null,
        beforeRemove: null,
        timeoutMs: 60_000
      },
      agent: {
        maxConcurrentAgents: 1,
        maxTurns: 2,
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
      server: { port: null },
      verification: {
        requiredKinds: [],
        workspaceSignals: []
      }
    };

    workflow = {
      path: "WORKFLOW.md",
      config: {},
      promptTemplate: "Work on {{ issue.identifier }}"
    };

    tracker = {
      fetchCandidateIssues: vi.fn().mockResolvedValue([issue]),
      fetchIssuesByStates: vi.fn().mockResolvedValue([]),
      fetchIssueStatesByIds: vi.fn().mockResolvedValue([{ ...issue }]),
      createIssueComment: vi.fn().mockResolvedValue(undefined),
      markIssueCompleted: vi.fn().mockResolvedValue(undefined),
      resolveDoneStateId: vi.fn().mockResolvedValue("state-done")
    };

    workspaceManager = {
      createForIssue: vi.fn().mockResolvedValue({ workspaceKey: "SYM-1", workspacePath: "/tmp/symphony/SYM-1" }),
      runBeforeRun: vi.fn().mockResolvedValue(undefined),
      runAfterRun: vi.fn().mockResolvedValue(undefined),
      removeWorkspace: vi.fn().mockResolvedValue(undefined),
      getWorkspacePath: vi.fn().mockReturnValue("/tmp/symphony/SYM-1")
    };
  });

  it("synthesizes messages for turn events and populates global feed", async () => {
    vi.mocked(worker.runWorkerAttempt).mockImplementation(async ({ onEvent }: any) => {
      onEvent({ timestamp: "2026-03-06T10:00:00.000Z", event: "session_started", message: "thread-1" });
      onEvent({ timestamp: "2026-03-06T10:00:01.000Z", event: "turn_started", message: null, turn_id: "1" });
      onEvent({ timestamp: "2026-03-06T10:00:02.000Z", event: "turn_completed", message: null, turn_id: "1" });
      await new Promise((resolve) => setTimeout(resolve, 150));
      return {
        turnsExecuted: 1,
        sessionId: "thread-1-1",
        startedAt: "2026-03-06T10:00:00.000Z",
        finishedAt: "2026-03-06T10:00:03.000Z",
        durationMs: 3000,
        exitReason: "normal",
        verifications: []
      };
    });

    const orchestrator = new Orchestrator({
      logger: NOOP_LOGGER,
      tracker,
      config,
      workflow,
      workspaceManager
    });

    await orchestrator.start();
    const runningRow = await waitFor(() => {
      const rows = orchestrator.getStateSnapshot().running;
      if (rows.length === 0) {
        return null;
      }
      return rows[0] ?? null;
    });

    expect(runningRow.last_message).toBe("Completed turn #1");

    const state = orchestrator.getStateSnapshot();
    expect(state.global_events.some((event) => event.message === "Completed turn #1")).toBe(true);
    expect(state.global_events.some((event) => event.message === "Starting turn #1...")).toBe(true);
    expect(state.global_events.every((event) => event.issue_identifier === "SYM-1")).toBe(true);

    await orchestrator.stop();
  });
});
