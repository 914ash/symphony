import { describe, expect, it, vi } from "vitest";
import { LinearTrackerAdapter } from "../../src/tracker.js";

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
};

function mockLinearResponse(payload: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(payload)
    } as unknown as Response)
  );
}

function baseConfig() {
  return {
    tracker: {
      kind: "linear",
      endpoint: "https://api.linear.app/graphql",
      apiKey: "token",
      projectSlug: "project",
      activeStates: ["Todo"],
      terminalStates: []
    },
    polling: { intervalMs: 30_000 },
    workspace: { root: "./symphony_workspaces" },
    hooks: {
      afterCreate: null,
      beforeRun: null,
      afterRun: null,
      beforeRemove: null,
      timeoutMs: 10_000
    },
    agent: {
      maxConcurrentAgents: 1,
      maxTurns: 1,
      maxRetryBackoffMs: 1000,
      maxConcurrentAgentsByState: {}
    },
    codex: {
      command: "codex app-server",
      launchMode: "strict",
      approvalPolicy: "full-auto",
      threadSandbox: "workspace-write",
      turnSandboxPolicy: "workspace-write",
      enableLinearGraphqlTool: false,
      turnTimeoutMs: 1000,
      readTimeoutMs: 1000,
      stallTimeoutMs: 1000
    },
    server: { port: 3000 }
  } as const;
}

describe("conformance: linear issue normalization", () => {
  it("derives blocked_by from inverse 'blocks' relation source", async () => {
    mockLinearResponse({
      data: {
        issues: {
          nodes: [
            {
              id: "issue-1",
              identifier: "SYM-1",
              title: "Find API sources",
              description: null,
              priority: 1,
              createdAt: "2026-03-05T10:00:00.000Z",
              updatedAt: "2026-03-05T11:00:00.000Z",
              state: { name: "Todo" },
              labels: { nodes: [] },
              inverseRelations: {
                nodes: [
                  {
                    type: "blocks",
                    relatedIssue: {
                      id: "issue-0",
                      identifier: "SYM-0",
                      state: { name: "In Progress" }
                    }
                  }
                ]
              }
            }
          ],
          pageInfo: { hasNextPage: false }
        }
      }
    });

    const adapter = new LinearTrackerAdapter(
      {
        ...baseConfig(),
        workspace: { root: "./symphony_workspaces" }
      } as any,
      logger as any
    );

    const issues = await adapter.fetchCandidateIssues(["Todo"]);

    expect(issues).toHaveLength(1);
    expect(issues[0].blockedBy).toEqual([
      {
        id: "issue-0",
        identifier: "SYM-0",
        state: "In Progress"
      }
    ]);
  });

  it("ignores forward blocking relations when computing blocked_by", async () => {
    mockLinearResponse({
      data: {
        issues: {
          nodes: [
            {
              id: "issue-2",
              identifier: "SYM-2",
              title: "Validate query",
              description: null,
              priority: 1,
              createdAt: "2026-03-05T10:00:00.000Z",
              updatedAt: "2026-03-05T11:00:00.000Z",
              state: { name: "Todo" },
              labels: { nodes: [] },
              relations: {
                nodes: [
                  {
                    type: "blocks",
                    relatedIssue: {
                      id: "issue-9",
                      identifier: "SYM-9",
                      state: { name: "Todo" }
                    }
                  }
                ]
              },
              inverseRelations: {
                nodes: []
              }
            }
          ],
          pageInfo: { hasNextPage: false }
        }
      }
    });

    const adapter = new LinearTrackerAdapter(
      {
        ...baseConfig(),
        workspace: { root: "./symphony_workspaces" }
      } as any,
      logger as any
    );

    const issues = await adapter.fetchCandidateIssues(["Todo"]);

    expect(issues).toHaveLength(1);
    expect(issues[0].blockedBy).toEqual([]);
  });
});
