import { afterEach, describe, expect, it } from "vitest";
import type http from "node:http";
import { startHttpServer } from "../../src/http-server.js";
import type { Logger } from "../../src/types.js";

const logger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
};

function baseUrl(server: http.Server): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("unexpected server address");
  }
  return `http://127.0.0.1:${address.port}`;
}

describe("conformance: issue detail endpoint", () => {
  let server: http.Server | null = null;

  afterEach(async () => {
    if (!server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => (error ? reject(error) : resolve()));
    });
    server = null;
  });

  it("includes recent_events in issue detail payload", async () => {
    const recentEvents = [
      { at: "2026-03-06T10:00:00.000Z", event: "turn_started", message: null },
      { at: "2026-03-06T10:00:05.000Z", event: "turn_completed", message: "ok" }
    ];

    server = await startHttpServer({
      orchestrator: {
        getStateSnapshot: () => ({
          generated_at: new Date().toISOString(),
          counts: { running: 0, retrying: 0 },
          running: [],
          retrying: [],
          codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
          rate_limits: null
        }),
        getIssueSnapshot: (identifier: string) =>
          identifier === "SYM-1"
            ? {
                issue_identifier: "SYM-1",
                issue_id: "issue-1",
                status: "running",
                workspace: { path: "/tmp/symphony/SYM-1" },
                attempts: { restart_count: 0, current_retry_attempt: null },
                running: {
                  session_id: "thread-1-turn-1",
                  turn_count: 1,
                  state: "Todo",
                  started_at: "2026-03-06T10:00:00.000Z",
                  last_event: "turn_completed",
                  last_message: "ok",
                  last_event_at: "2026-03-06T10:00:05.000Z",
                  tokens: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
                },
                retry: null,
                recent_events: recentEvents
              }
            : null,
        requestRefresh: () => ({ queued: true, coalesced: false, requestedAt: new Date().toISOString() })
      } as any,
      logger,
      port: 0
    });

    const response = await fetch(`${baseUrl(server)}/api/v1/SYM-1`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.recent_events).toEqual(recentEvents);
  });

  it("returns issue_not_found envelope for unknown issue", async () => {
    server = await startHttpServer({
      orchestrator: {
        getStateSnapshot: () => ({
          generated_at: new Date().toISOString(),
          counts: { running: 0, retrying: 0 },
          running: [],
          retrying: [],
          codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
          rate_limits: null
        }),
        getIssueSnapshot: () => null,
        requestRefresh: () => ({ queued: true, coalesced: false, requestedAt: new Date().toISOString() })
      } as any,
      logger,
      port: 0
    });

    const response = await fetch(`${baseUrl(server)}/api/v1/DOES-NOT-EXIST`);
    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload).toEqual({
      error: {
        code: "issue_not_found",
        message: "issue 'DOES-NOT-EXIST' was not found"
      }
    });
  });
});
