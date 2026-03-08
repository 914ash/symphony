import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { Logger } from "./types.js";
import type { Orchestrator } from "./orchestrator.js";

function writeJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function issueNotFound(identifier: string): { error: { code: string; message: string } } {
  return {
    error: {
      code: "issue_not_found",
      message: `issue '${identifier}' was not found`
    }
  };
}

function htmlEscape(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDuration(seconds: number): string {
  const rounded = Math.max(seconds, 0);
  if (rounded < 60) {
    return `${rounded.toFixed(1)}s`;
  }
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${minutes}m ${Math.floor(remainder)}s`;
}

function renderRuntimeBlocks(snapshot: ReturnType<Orchestrator["getStateSnapshot"]>): string {
  const rateLimits = snapshot.rate_limits ? htmlEscape(JSON.stringify(snapshot.rate_limits)) : "none";
  return `
    <section class="panel glass" id="runtime-grid">
      <div class="panel-title">Runtime Overview</div>
      <div class="stat-grid">
        <div class="stat">
          <label>Running</label>
          <div>${htmlEscape(snapshot.counts.running)}</div>
        </div>
        <div class="stat">
          <label>Retrying</label>
          <div>${htmlEscape(snapshot.counts.retrying)}</div>
        </div>
        <div class="stat">
          <label>Input Tokens</label>
          <div>${htmlEscape(snapshot.codex_totals.input_tokens)}</div>
        </div>
        <div class="stat">
          <label>Output Tokens</label>
          <div>${htmlEscape(snapshot.codex_totals.output_tokens)}</div>
        </div>
        <div class="stat">
          <label>Total Tokens</label>
          <div>${htmlEscape(snapshot.codex_totals.total_tokens)}</div>
        </div>
        <div class="stat">
          <label>Runtime</label>
          <div>${formatDuration(snapshot.codex_totals.seconds_running)}</div>
        </div>
        <div class="stat span-2">
          <label>Rate limit snapshot</label>
          <pre>${rateLimits}</pre>
        </div>
      </div>
    </section>`;
}

function renderRunningRows(running: ReturnType<Orchestrator["getStateSnapshot"]>["running"]): string {
  if (running.length === 0) {
    return `<tr><td colspan="11" class="muted">no running sessions</td></tr>`;
  }
  return running
    .map((row) => {
      const runningFor = row.started_at ? new Date(row.started_at).toLocaleTimeString() : "";
      const wbStatus = row.writeback_status ?? "pending";
      const duration = formatDuration((row.duration_ms ?? 0) / 1000);
      return `
        <tr>
          <td><a href="/api/v1/${encodeURIComponent(row.issue_identifier)}">${htmlEscape(row.issue_identifier)}</a></td>
          <td>${htmlEscape(row.state)}</td>
          <td>${htmlEscape(row.turn_count)}</td>
          <td>${htmlEscape(row.verification_summary ?? "0/0")}</td>
          <td>${htmlEscape(wbStatus)}</td>
          <td>${htmlEscape(row.session_id ?? "-")}</td>
          <td>${htmlEscape(row.last_event ?? "-")}</td>
          <td>${htmlEscape(row.last_message ?? "-")}</td>
          <td>${htmlEscape(row.tokens.total_tokens)}</td>
          <td>${htmlEscape(duration)}</td>
          <td>${htmlEscape(runningFor)}</td>
        </tr>`;
    })
    .join("");
}

function renderRetryRows(
  retrying: ReturnType<Orchestrator["getStateSnapshot"]>["retrying"]
): string {
  if (retrying.length === 0) {
    return `<tr><td colspan="4" class="muted">retry queue empty</td></tr>`;
  }
  return retrying
    .map((row) =>
      `<tr><td>${htmlEscape(row.issue_identifier)}</td><td>${htmlEscape(row.attempt)}</td><td>${htmlEscape(
        row.due_at
      )}</td><td>${htmlEscape(row.error ?? "-")}</td></tr>`
    )
    .join("");
}

function renderGlobalEvents(
  events: ReturnType<Orchestrator["getStateSnapshot"]>["global_events"]
): string {
  if (!events || events.length === 0) {
    return `<div class="muted" style="padding: 12px">no recent activity</div>`;
  }
  return [...events]
    .reverse()
    .map((row) => {
      const at = new Date(row.at).toLocaleTimeString();
      let colorClass = "";
      if (row.event === "turn_failed" || row.event.includes("error")) colorClass = "text-error";
      else if (row.event === "turn_completed") colorClass = "text-success";
      else if (row.event === "retry_scheduled") colorClass = "text-warn";

      return `<div class="event-item">
        <span class="event-at">${htmlEscape(at)}</span>
        <span class="event-issue">[${htmlEscape(row.issue_identifier)}]</span>
        <span class="event-kind ${colorClass}">${htmlEscape(row.event)}</span>
        <span class="event-msg">${htmlEscape(row.message)}</span>
      </div>`;
    })
    .join("");
}

function renderDashboard(snapshot: ReturnType<Orchestrator["getStateSnapshot"]>): string {
  const bootstrapState = JSON.stringify(snapshot, null, 2)
    .replace(/</g, "\\u003c")
    .replace(/<\/script/gi, "<\\\\/script");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Symphony Runtime</title>
    <style>
      :root {
        --bg: #06070e;
        --panel: rgba(255, 255, 255, 0.08);
        --panel-soft: rgba(255, 255, 255, 0.04);
        --text: #e5ecff;
        --muted: #9aa7d9;
        --line: rgba(120, 136, 208, 0.32);
        --accent: #4de2ff;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        padding: 28px;
        font-family: "IBM Plex Mono", "Fira Code", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
        background:
          radial-gradient(circle at 8% 12%, rgba(77, 226, 255, 0.08), transparent 38%),
          radial-gradient(circle at 80% 86%, rgba(136, 99, 255, 0.06), transparent 44%),
          linear-gradient(165deg, #05060d 0%, #070d1e 45%, #0a0f25 100%);
        color: var(--text);
      }
      .top {
        max-width: 1200px;
        margin: 0 auto;
        animation: reveal 480ms ease-out both;
      }
      .hero {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      h1 {
        margin: 0;
        font-size: 28px;
        letter-spacing: 0.2px;
      }
      h1, .subtitle {
        margin: 0;
      }
      .subtitle {
        color: var(--muted);
        font-size: 12px;
      }
      .controls {
        display: flex;
        gap: 10px;
        align-items: center;
      }
      .controls button,
      .controls a {
        border: 1px solid rgba(77, 226, 255, 0.35);
        background: var(--panel);
        color: var(--text);
        border-radius: 10px;
        padding: 8px 12px;
        font: inherit;
        text-decoration: none;
        cursor: pointer;
      }
      .controls button:hover,
      .controls a:hover {
        border-color: rgba(77, 226, 255, 0.8);
        background: rgba(77, 226, 255, 0.15);
      }
      .panel {
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 16px;
        background: var(--panel);
        backdrop-filter: blur(4px);
        box-shadow: 0 18px 38px rgba(0, 0, 0, 0.33);
        animation: reveal 680ms ease-out both;
      }
      .glass {
        background: var(--panel-soft);
      }
      .panel-title {
        color: var(--accent);
        font-weight: 700;
        margin-bottom: 10px;
        letter-spacing: 0.4px;
      }
      .stat-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 10px;
      }
      .stat {
        border: 1px solid rgba(120, 136, 208, 0.3);
        border-radius: 12px;
        padding: 10px;
        background: rgba(255, 255, 255, 0.03);
      }
      .stat label {
        display: block;
        color: var(--muted);
        font-size: 11px;
        margin-bottom: 6px;
      }
      .stat div {
        font-size: 22px;
        font-weight: 700;
      }
      .stat pre {
        margin: 0;
        font-size: 11px;
        white-space: pre-wrap;
        word-break: break-all;
      }
      .table-wrap {
        overflow: auto;
      }
      table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
      }
      thead th {
        text-align: left;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: var(--muted);
        border-bottom: 1px solid rgba(255, 255, 255, 0.14);
        padding: 8px;
      }
      tbody td {
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        padding: 10px 8px;
        font-size: 13px;
        vertical-align: top;
      }
      tbody td a {
        color: var(--text);
      }
      .muted {
        color: var(--muted);
      }
      .status {
        margin-top: 10px;
        color: var(--muted);
        font-size: 12px;
      }
      .status .good {
        color: #61e2a6;
      }
      .status .warn {
        color: #ffd166;
      }
      .text-success { color: #61e2a6; }
      .text-error { color: #ff5c5c; }
      .text-warn { color: #ffd166; }
      .event-feed {
        max-height: 300px;
        overflow-y: auto;
        font-size: 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .event-item {
        display: flex;
        gap: 8px;
        padding: 4px 8px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.02);
      }
      .event-at { color: var(--muted); min-width: 80px; }
      .event-issue { color: var(--accent); font-weight: 700; min-width: 60px; }
      .event-kind { font-weight: 700; min-width: 120px; }
      .event-msg { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .span-2 {
        grid-column: span 2;
      }
      @keyframes reveal {
        from {
          transform: translateY(4px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
      @media (max-width: 720px) {
        body {
          padding: 16px;
        }
        h1 {
          font-size: 22px;
        }
      }
    </style>
  </head>
  <body>
    <div class="top">
      <div class="hero">
        <div>
          <h1>Symphony Runtime</h1>
          <p class="subtitle" id="generated">Generated at ${snapshot.generated_at}</p>
        </div>
        <div class="controls">
          <button id="refreshBtn">refresh</button>
          <a href="/api/v1/state" target="_blank">state json</a>
          <a href="/api/v1/refresh" target="_blank">raw refresh endpoint</a>
          <span id="tick" class="muted"></span>
        </div>
      </div>

      ${renderRuntimeBlocks(snapshot)}

      <section class="panel">
        <div class="panel-title">Running Sessions</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Issue</th>
                <th>State</th>
                <th>Turns</th>
                <th>Verif</th>
                <th>WB</th>
                <th>Session</th>
                <th>Last Event</th>
                <th>Last Message</th>
                <th>Tokens</th>
                <th>Time</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody id="runningBody">
              ${renderRunningRows(snapshot.running)}
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">Retry Queue</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Issue</th>
                <th>Attempt</th>
                <th>Due At</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody id="retryBody">
              ${renderRetryRows(snapshot.retrying)}
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">Live Activity Feed</div>
        <div class="event-feed" id="eventFeed">
          ${renderGlobalEvents(snapshot.global_events)}
        </div>
      </section>

      <p class="status" id="status">Auto-refresh <span class="good">active</span> every 2s</p>
    </div>
    <script type="application/json" id="bootstrap-state">${bootstrapState}</script>
    <script>
      (function () {
        const runtimeStateEl = document.getElementById("runtime-grid");
        const runningBody = document.getElementById("runningBody");
        const retryBody = document.getElementById("retryBody");
        const generatedEl = document.getElementById("generated");
        const statusEl = document.getElementById("status");
        const tickEl = document.getElementById("tick");
        const refreshBtn = document.getElementById("refreshBtn");
        const eventFeed = document.getElementById("eventFeed");

        const bootstrapEl = document.getElementById("bootstrap-state");
        let currentState = JSON.parse(bootstrapEl ? bootstrapEl.textContent || "{}" : "{}");
        const POLL_MS = 2000;
        let countdown = POLL_MS / 1000;

        function esc(value) {
          return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\\"/g, "&quot;")
            .replace(/'/g, "&#39;");
        }

        function formatSec(seconds) {
          const n = Number(seconds || 0);
          if (n < 60) {
            return n.toFixed(1) + "s";
          }
          const min = Math.floor(n / 60);
          return min + "m " + Math.floor(n % 60) + "s";
        }

        function render() {
          if (!currentState || !runningBody || !retryBody || !generatedEl || !runtimeStateEl || !eventFeed) {
            return;
          }

          generatedEl.textContent = "Generated at " + (currentState.generated_at || "-");
          runtimeStateEl.innerHTML =
            '<div class="panel-title">Runtime Overview</div>' +
            '<div class="stat-grid">' +
            '<div class="stat"><label>Running</label><div>' +
            esc((currentState.counts && currentState.counts.running) || 0) +
            "</div></div>" +
            '<div class="stat"><label>Retrying</label><div>' +
            esc((currentState.counts && currentState.counts.retrying) || 0) +
            "</div></div>" +
            '<div class="stat"><label>Input Tokens</label><div>' +
            esc(((currentState.codex_totals && currentState.codex_totals.input_tokens) || 0)) +
            "</div></div>" +
            '<div class="stat"><label>Output Tokens</label><div>' +
            esc(((currentState.codex_totals && currentState.codex_totals.output_tokens) || 0)) +
            "</div></div>" +
            '<div class="stat"><label>Total Tokens</label><div>' +
            esc(((currentState.codex_totals && currentState.codex_totals.total_tokens) || 0)) +
            "</div></div>" +
            '<div class="stat"><label>Runtime</label><div>' +
            formatSec((currentState.codex_totals && currentState.codex_totals.seconds_running) || 0) +
            "</div></div>" +
            '<div class="stat span-2"><label>Rate limit snapshot</label><pre>' +
            esc(currentState.rate_limits ? JSON.stringify(currentState.rate_limits) : "none") +
            "</pre></div>" +
            "</div>";

          if ((currentState.running || []).length === 0) {
            runningBody.innerHTML = '<tr><td colspan="11" class="muted">no running sessions</td></tr>';
          } else {
            runningBody.innerHTML = currentState.running
              .map((row) => {
                const started = row.started_at ? new Date(row.started_at).toLocaleTimeString() : "-";
                const wbStatus = row.writeback_status || "pending";
                const duration = formatSec((row.duration_ms || 0) / 1000);
                return (
                  '<tr>' +
                  '<td><a href="/api/v1/' +
                  encodeURIComponent(row.issue_identifier) +
                  '">' +
                  esc(row.issue_identifier) +
                  "</a></td>" +
                  "<td>" +
                  esc(row.state) +
                  "</td>" +
                  "<td>" +
                  esc(row.turn_count) +
                  "</td>" +
                  "<td>" +
                  esc(row.verification_summary || "0/0") +
                  "</td>" +
                  "<td>" +
                  esc(wbStatus) +
                  "</td>" +
                  "<td>" +
                  esc(row.session_id || "-") +
                  "</td>" +
                  "<td>" +
                  esc(row.last_event || "-") +
                  "</td>" +
                  "<td>" +
                  esc(row.last_message || "-") +
                  "</td>" +
                  "<td>" +
                  esc(((row.tokens || {}).total_tokens || 0)) +
                  "</td>" +
                  "<td>" +
                  esc(duration) +
                  "</td>" +
                  "<td>" +
                  esc(started) +
                  "</td>" +
                  "</tr>"
                );
              })
              .join("");
          }

          if ((currentState.retrying || []).length === 0) {
            retryBody.innerHTML = '<tr><td colspan="4" class="muted">retry queue empty</td></tr>';
          } else {
            retryBody.innerHTML = currentState.retrying
              .map((row) => (
                "<tr>" +
                "<td>" +
                esc(row.issue_identifier) +
                "</td>" +
                "<td>" +
                esc(row.attempt) +
                "</td>" +
                "<td>" +
                esc(row.due_at) +
                "</td>" +
                "<td>" +
                esc(row.error || "-") +
                "</td>" +
                "</tr>"
              ))
              .join("");
          }

          if ((currentState.global_events || []).length === 0) {
            eventFeed.innerHTML = '<div class="muted" style="padding: 12px">no recent activity</div>';
          } else {
            eventFeed.innerHTML = currentState.global_events
              .slice()
              .reverse()
              .map((row) => {
                const at = new Date(row.at).toLocaleTimeString();
                let colorClass = "";
                if (row.event === "turn_failed" || row.event.includes("error")) colorClass = "text-error";
                else if (row.event === "turn_completed") colorClass = "text-success";
                else if (row.event === "retry_scheduled") colorClass = "text-warn";

                return (
                  '<div class="event-item">' +
                  '<span class="event-at">' + esc(at) + '</span>' +
                  '<span class="event-issue">[' + esc(row.issue_identifier) + ']</span>' +
                  '<span class="event-kind ' + colorClass + '">' + esc(row.event) + '</span>' +
                  '<span class="event-msg">' + esc(row.message) + '</span>' +
                  '</div>'
                );
              })
              .join("");
          }
        }

        function setStatus(kind, message) {
          if (!statusEl) {
            return;
          }
          if (kind === "error") {
            statusEl.innerHTML = 'Auto-refresh <span class="warn">disconnected</span>: ' + message;
            return;
          }
          if (kind === "refreshing") {
            statusEl.innerHTML = '<span class="good">' + message + "</span>";
            return;
          }
          statusEl.innerHTML = 'Auto-refresh <span class="good">active</span> every 2s';
        }

        async function pollState() {
          try {
            const res = await fetch("/api/v1/state", { cache: "no-cache" });
            if (!res.ok) {
              throw new Error("state request failed (" + res.status + ")");
            }
            currentState = await res.json();
            render();
            setStatus("tick");
          } catch (error) {
            setStatus("error", "retrying");
          }
        }

        setInterval(() => {
          if (countdown <= 1) {
            countdown = 2;
            void pollState();
          } else {
            countdown -= 1;
          }
          if (tickEl) {
            tickEl.textContent = "next refresh in " + countdown + "s";
          }
        }, 1000);

        if (refreshBtn) {
          refreshBtn.addEventListener("click", async () => {
            if (refreshBtn.disabled) {
              return;
            }
            refreshBtn.disabled = true;
            setStatus("refreshing", "requesting reconcile...");
            try {
              const res = await fetch("/api/v1/refresh", { method: "POST" });
              if (!res.ok) {
                const body = await res.text().catch(() => "");
                throw new Error("refresh failed (" + res.status + " " + (body || "") + ")");
              }
              setStatus("tick");
              await pollState();
            } catch (error) {
              setStatus("error", String(error.message || error));
            } finally {
              refreshBtn.disabled = false;
              setTimeout(() => setStatus("tick"), 1000);
            }
          });
        }

        if (tickEl) {
          tickEl.textContent = "next refresh in " + countdown + "s";
        }
        render();
      })();
    </script>
  </body>
</html>`;
}

export async function startHttpServer(params: {
  orchestrator: Orchestrator;
  logger: Logger;
  port: number;
  host?: string;
}): Promise<http.Server> {
  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? "GET";
    const host = req.headers.host ?? "127.0.0.1";
    const requestUrl = new URL(req.url ?? "/", `http://${host}`);
    const pathname = requestUrl.pathname;

    if (pathname === "/" && method === "GET") {
      const snapshot = params.orchestrator.getStateSnapshot();
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(renderDashboard(snapshot));
      return;
    }

    if (pathname === "/api/v1/state") {
      if (method !== "GET") {
        writeJson(res, 405, { error: { code: "method_not_allowed", message: "only GET is supported" } });
        return;
      }
      writeJson(res, 200, params.orchestrator.getStateSnapshot());
      return;
    }

    if (pathname.startsWith("/api/v1/") && pathname !== "/api/v1/refresh") {
      if (method !== "GET") {
        writeJson(res, 405, { error: { code: "method_not_allowed", message: "only GET is supported" } });
        return;
      }
      const identifier = decodeURIComponent(pathname.replace("/api/v1/", ""));
      const payload = params.orchestrator.getIssueSnapshot(identifier);
      if (!payload) {
        writeJson(res, 404, issueNotFound(identifier));
        return;
      }
      writeJson(res, 200, payload);
      return;
    }

    if (pathname === "/api/v1/refresh") {
      if (method !== "POST") {
        writeJson(res, 405, { error: { code: "method_not_allowed", message: "only POST is supported" } });
        return;
      }
      const queued = params.orchestrator.requestRefresh();
      writeJson(res, 202, {
        queued: queued.queued,
        coalesced: queued.coalesced,
        requested_at: queued.requestedAt,
        operations: ["poll", "reconcile"]
      });
      return;
    }

    writeJson(res, 404, { error: { code: "not_found", message: "route not found" } });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(params.port, params.host ?? "127.0.0.1", () => resolve());
  });

  const address = server.address();
  params.logger.info("http_server_started", { address });
  return server;
}
