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

describe("conformance: dashboard live feed", () => {
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

  it("renders the live activity feed panel and bootstrap events", async () => {
    const globalEvents = [
      {
        at: "2026-03-06T10:00:05.000Z",
        event: "turn_completed",
        message: "Completed turn #1",
        issue_identifier: "SYM-1"
      }
    ];

    server = await startHttpServer({
      orchestrator: {
        getStateSnapshot: () => ({
          generated_at: new Date().toISOString(),
          counts: { running: 0, retrying: 0 },
          running: [],
          retrying: [],
          global_events: globalEvents,
          codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
          rate_limits: null
        }),
        getIssueSnapshot: () => null,
        requestRefresh: () => ({ queued: true, coalesced: false, requestedAt: new Date().toISOString() })
      } as any,
      logger,
      port: 0
    });

    const response = await fetch(`${baseUrl(server)}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain("Live Activity Feed");
    expect(html).toContain('id="eventFeed"');
    expect(html).toContain('const eventFeed = document.getElementById("eventFeed")');
    expect(html).toContain("Completed turn #1");

    const match = html.match(/<script type="application\/json" id="bootstrap-state">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    expect(() => JSON.parse((match?.[1] ?? "").trim())).not.toThrow();
  });
});
