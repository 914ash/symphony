import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../src/config.js";
import { createLogger } from "../../src/logger.js";
import { Orchestrator } from "../../src/orchestrator.js";
import type { Issue, WorkflowDefinition } from "../../src/types.js";
import { WorkspaceManager } from "../../src/workspace.js";
import { runWorkerAttempt } from "../../src/worker.js";

vi.mock("../../src/worker.js", () => ({
  runWorkerAttempt: vi.fn()
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

describe("conformance: turn_count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tracks executed turns instead of retry attempt count in state snapshot", async () => {
    const deferred = createDeferred<{ turnsExecuted: number; sessionId: string }>();
    const mockedRunWorkerAttempt = vi.mocked(runWorkerAttempt);
    mockedRunWorkerAttempt.mockImplementation(async (params) => {
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
    } finally {
      deferred.resolve({ turnsExecuted: 2, sessionId: "thread-1-turn-2" });
      await waitFor(() => orchestrator.getStateSnapshot().running.length === 0).catch(() => undefined);
      await orchestrator.stop();
    }
  });
});
