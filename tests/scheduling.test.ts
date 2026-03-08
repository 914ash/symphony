import { describe, expect, it } from "vitest";
import { retryDelayMs, shouldDispatchIssue, sortIssuesForDispatch } from "../src/scheduling.js";
import type { Issue, RuntimeState, ServiceConfig } from "../src/types.js";

const baseConfig: ServiceConfig = {
  tracker: {
    kind: "linear",
    endpoint: "x",
    apiKey: "x",
    projectSlug: "X",
    activeStates: ["Todo", "In Progress"],
    terminalStates: ["Done"]
  },
  polling: { intervalMs: 30000 },
  workspace: { root: "/tmp" },
  hooks: { afterCreate: null, beforeRun: null, afterRun: null, beforeRemove: null, timeoutMs: 60000 },
  agent: { maxConcurrentAgents: 10, maxTurns: 20, maxRetryBackoffMs: 300000, maxConcurrentAgentsByState: {} },
  codex: {
    command: "codex app-server",
    launchMode: "compatible",
    approvalPolicy: "full-auto",
    threadSandbox: "workspace-write",
    turnSandboxPolicy: "workspace-write",
    enableLinearGraphqlTool: false,
    turnTimeoutMs: 1,
    readTimeoutMs: 1,
    stallTimeoutMs: 1
  },
  server: { port: null }
};

const emptyState: RuntimeState = {
  running: new Map(),
  claimed: new Set(),
  retryAttempts: new Map(),
  completed: new Set(),
  codexTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, secondsRunning: 0 },
  codexRateLimits: null
};

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: "id",
    identifier: "ABC-1",
    title: "Title",
    state: "Todo",
    labels: [],
    blockedBy: [],
    ...overrides
  };
}

describe("scheduling", () => {
  it("sorts by priority then created_at then identifier", () => {
    const sorted = sortIssuesForDispatch([
      issue({ id: "3", identifier: "C", priority: 2 }),
      issue({ id: "1", identifier: "A", priority: 1 }),
      issue({ id: "2", identifier: "B", priority: 1, createdAt: "2020-01-01T00:00:00.000Z" })
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["2", "1", "3"]);
  });

  it("blocks Todo with non-terminal blockers", () => {
    const ok = shouldDispatchIssue(
      issue({
        blockedBy: [{ id: "b", identifier: "B", state: "Done" }]
      }),
      baseConfig,
      emptyState
    );
    const blocked = shouldDispatchIssue(
      issue({
        blockedBy: [{ id: "b", identifier: "B", state: "In Progress" }]
      }),
      baseConfig,
      emptyState
    );
    expect(ok).toBe(true);
    expect(blocked).toBe(false);
  });

  it("calculates continuation and exponential delays", () => {
    expect(retryDelayMs(1, true, 300000)).toBe(1000);
    expect(retryDelayMs(1, false, 300000)).toBe(10000);
    expect(retryDelayMs(4, false, 300000)).toBe(80000);
    expect(retryDelayMs(10, false, 300000)).toBe(300000);
  });
});
