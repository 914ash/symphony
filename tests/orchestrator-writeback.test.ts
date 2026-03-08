import { describe, expect, it, vi, beforeEach } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { createLogger } from "../src/logger.js";
import type { Issue, ServiceConfig, WorkflowDefinition } from "../src/types.js";
import * as worker from "../src/worker.js";

vi.mock("../src/worker.js", () => ({
  runWorkerAttempt: vi.fn()
}));

const NOOP_LOGGER = createLogger("error");

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error("timed out");
}

describe("Orchestrator: Write-Back Flow", () => {
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
          enabled: true,
          doneState: "Done"
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
        requiredKinds: ["test"],
        workspaceSignals: ["dist/index.js"]
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

    vi.mock("node:fs/promises", () => ({
      access: vi.fn().mockResolvedValue(undefined)
    }));
  });

  it("should perform write-back (comment + state) when verification passes", async () => {
    vi.mocked(worker.runWorkerAttempt).mockResolvedValue({
      turnsExecuted: 2,
      sessionId: "thread-1-turn-2",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 1000,
      exitReason: "normal",
      verifications: [{ kind: "test", passed: true, at: new Date().toISOString() }]
    });

    const orchestrator = new Orchestrator({
      logger: NOOP_LOGGER,
      tracker,
      config,
      workflow,
      workspaceManager
    });

    await orchestrator.start();
    await waitFor(() => tracker.createIssueComment.mock.calls.length > 0 || tracker.markIssueCompleted.mock.calls.length > 0).catch(() => {});
    await orchestrator.stop();

    expect(tracker.createIssueComment).toHaveBeenCalled();
    expect(tracker.markIssueCompleted).toHaveBeenCalledWith(issue.id, config.tracker.writeback.doneState);
  });

  it("should skip state transition if verification fails", async () => {
    vi.mocked(worker.runWorkerAttempt).mockResolvedValue({
      turnsExecuted: 2,
      sessionId: "thread-1-turn-2",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 1000,
      exitReason: "normal",
      verifications: [{ kind: "test", passed: false, at: new Date().toISOString() }]
    });

    const orchestrator = new Orchestrator({
      logger: NOOP_LOGGER,
      tracker,
      config,
      workflow,
      workspaceManager
    });

    await orchestrator.start();
    // Wait for the issue to be picked up and processed
    await new Promise(r => setTimeout(r, 200)); 
    await orchestrator.stop();

    expect(tracker.createIssueComment).not.toHaveBeenCalled();
    expect(tracker.markIssueCompleted).not.toHaveBeenCalled();
  });
});
