import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { SymphonyError } from "./errors.js";
import { getCodexLaunchCommand } from "./shell.js";
import type { CodexConfig, Logger } from "./types.js";

interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

interface PendingResponse {
  resolve: (value: RpcMessage) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
}

function asError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(String(value));
}

export interface AgentEvent {
  event: string;
  timestamp?: string;
  message?: string;
  error_code?: string;
  turn_id?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  rate_limits?: unknown;
}

function parseErrorCode(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;

  const candidates = [obj.error_code, obj.error, obj.code];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const normalized = candidate.trim();
      if (normalized.length > 0) {
        return normalized;
      }
    }
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      const nestedCode = (nested.code ?? nested.message ?? nested.error_code) as unknown;
      if (typeof nestedCode === "string") {
        const normalized = nestedCode.trim();
        if (normalized.length > 0) {
          return normalized;
        }
      }
    }
  }

  return undefined;
}

export interface AppServerSession {
  threadId: string;
  stop: () => Promise<void>;
  runTurn: (params: {
    prompt: string;
    title: string;
    onEvent: (event: AgentEvent) => void;
    signal?: AbortSignal;
  }) => Promise<{ turnId: string }>;
}

function stringifyLine(payload: Record<string, unknown>): string {
  return `${JSON.stringify(payload)}\n`;
}

function parseUsage(raw: unknown): AgentEvent["usage"] | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const input =
    (obj.input_tokens as number | undefined) ??
    (obj.inputTokens as number | undefined) ??
    ((obj.total_token_usage as Record<string, unknown> | undefined)?.input_tokens as number | undefined);
  const output =
    (obj.output_tokens as number | undefined) ??
    (obj.outputTokens as number | undefined) ??
    ((obj.total_token_usage as Record<string, unknown> | undefined)?.output_tokens as number | undefined);
  const total =
    (obj.total_tokens as number | undefined) ??
    (obj.totalTokens as number | undefined) ??
    ((obj.total_token_usage as Record<string, unknown> | undefined)?.total_tokens as number | undefined);
  if (input === undefined && output === undefined && total === undefined) {
    return undefined;
  }
  return { input_tokens: input, output_tokens: output, total_tokens: total };
}

function normalizeThreadSandbox(raw: string, logger: Logger): string {
  const value = raw.trim().toLowerCase();
  if (value === "workspace-write" || value === "workspace_write" || value === "workspacewrite") {
    return "workspace-write";
  }
  if (value === "read-only" || value === "readonly" || value === "read_only") {
    return "read-only";
  }
  if (value === "external-sandbox" || value === "external_sandbox") {
    return "external-sandbox";
  }
  if (value === "danger-full-access" || value === "dangerfullaccess") {
    return "danger-full-access";
  }
  if (value === "dangerfull_access") {
    return "danger-full-access";
  }
  if (value === "externalsandbox") {
    return "external-sandbox";
  }
  if (value === "workspacewrite") {
    return "workspace-write";
  }
  if (value === "readonly") {
    return "read-only";
  }
  if (value === "readOnly".toLowerCase()) {
    return "read-only";
  }
  if (value === "externalSandbox".toLowerCase()) {
    return "external-sandbox";
  }
  if (value === "workspaceWrite".toLowerCase()) {
    return "workspace-write";
  }
  if (value === "dangerFullAccess".toLowerCase()) {
    return "danger-full-access";
  }
  logger.warn("unsupported_thread_sandbox_mode_fallback", { configured: raw, fallback: "workspace-write" });
  return "workspace-write";
}

function normalizeTurnSandbox(raw: string, logger: Logger): string {
  const value = raw.trim().toLowerCase();
  if (value === "workspace-write" || value === "workspace_write" || value === "workspacewrite") {
    return "workspaceWrite";
  }
  if (value === "read-only" || value === "readonly" || value === "read_only") {
    return "readOnly";
  }
  if (value === "external-sandbox" || value === "external_sandbox") {
    return "externalSandbox";
  }
  if (value === "danger-full-access" || value === "dangerfullaccess") {
    return "dangerFullAccess";
  }
  if (value === "dangerfull_access") {
    return "dangerFullAccess";
  }
  if (value === "externalsandbox") {
    return "externalSandbox";
  }
  if (value === "workspacewrite") {
    return "workspaceWrite";
  }
  logger.warn("unsupported_turn_sandbox_mode_fallback", { configured: raw, fallback: "workspaceWrite" });
  return "workspaceWrite";
}

function parseTurnId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const direct =
    (obj.turn_id as string | undefined) ??
    (obj.turnId as string | undefined) ??
    ((obj.turn as Record<string, unknown> | undefined)?.id as string | undefined);
  if (!direct) {
    return undefined;
  }
  const value = String(direct).trim();
  return value.length > 0 ? value : undefined;
}

function normalizeApprovalPolicy(raw: string, logger: Logger): string {
  const value = raw.trim().toLowerCase();
  if (value === "full-auto") {
    return "never";
  }
  if (value === "untrusted" || value === "on-failure" || value === "on-request" || value === "reject" || value === "never") {
    return value;
  }
  logger.warn("unsupported_approval_policy_fallback", { configured: raw, fallback: "on-request" });
  return "on-request";
}

export class AppServerClient {
  readonly #logger: Logger;
  readonly #config: CodexConfig;

  constructor(config: CodexConfig, logger: Logger) {
    this.#logger = logger;
    this.#config = config;
  }

  async startSession(options: {
    workspacePath: string;
    initialPrompt: string;
    title: string;
    onEvent: (event: AgentEvent) => void;
    tools?: unknown[];
    onToolCall?: (name: string, input: unknown) => Promise<unknown>;
  }): Promise<AppServerSession> {
    const launch = await getCodexLaunchCommand(this.#config.command, this.#logger, this.#config.launchMode);
    const approvalPolicy = normalizeApprovalPolicy(this.#config.approvalPolicy, this.#logger);
    const threadSandbox = normalizeThreadSandbox(this.#config.threadSandbox, this.#logger);
    const turnSandbox = normalizeTurnSandbox(this.#config.turnSandboxPolicy, this.#logger);
    const proc = spawn(launch.command, launch.args, {
      cwd: options.workspacePath,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const pid = proc.pid ?? null;

    const pending = new Map<number, PendingResponse>();
    let nextId = 1;
    let readBuffer = "";
    let closing = false;
    let closed = false;
    let threadId = "";

    const emit = (event: AgentEvent) => {
      options.onEvent({ ...event, timestamp: new Date().toISOString() });
    };

    const writeJson = (payload: Record<string, unknown>) => {
      proc.stdin.write(stringifyLine(payload));
    };

    const request = async (method: string, params: Record<string, unknown>): Promise<RpcMessage> => {
      const id = nextId++;
      writeJson({ id, method, params });

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new SymphonyError("response_timeout", `request timed out: ${method}`));
        }, this.#config.readTimeoutMs);
        pending.set(id, { resolve, reject, timer });
      });
    };

    const respond = (id: number | string, result: unknown) => {
      writeJson({ id, result });
    };

    let currentTurn:
      | {
          resolve: (value: { turnId: string }) => void;
          reject: (error: Error) => void;
          turnId: string;
          timeout: NodeJS.Timeout;
        }
      | undefined;
    let pendingTurnTerminal:
      | { kind: "completed" }
      | { kind: "failed"; error: Error }
      | { kind: "cancelled"; error: Error }
      | { kind: "input_required"; error: Error }
      | null = null;

    const failCurrentTurn = (error: Error) => {
      if (!currentTurn) {
        return;
      }
      clearTimeout(currentTurn.timeout);
      currentTurn.reject(error);
      currentTurn = undefined;
    };

    const completeCurrentTurn = () => {
      if (!currentTurn) {
        return;
      }
      clearTimeout(currentTurn.timeout);
      const turnId = currentTurn.turnId;
      currentTurn.resolve({ turnId });
      currentTurn = undefined;
    };

    const handleNotification = async (message: RpcMessage) => {
      const method = message.method ?? "";
      const params = message.params ?? {};
      const parsedTurnId = parseTurnId(params);
      if (currentTurn && !currentTurn.turnId && parsedTurnId) {
        currentTurn.turnId = parsedTurnId;
      }
      const turnIdForEvent = currentTurn?.turnId || parsedTurnId;

      const usage = parseUsage(params);
      const rateLimits = (params as Record<string, unknown>).rate_limits;
      const errorCode = parseErrorCode(params);

      if (method.includes("turn/completed")) {
        emit({ event: "turn_completed", turn_id: turnIdForEvent, usage, rate_limits: rateLimits });
        if (!currentTurn) {
          pendingTurnTerminal = { kind: "completed" };
          return;
        }
        if (!currentTurn.turnId) {
          pendingTurnTerminal = { kind: "completed" };
          return;
        }
        completeCurrentTurn();
        return;
      }
      if (method.includes("turn/failed")) {
        emit({ event: "turn_failed", turn_id: turnIdForEvent, usage, rate_limits: rateLimits, error_code: errorCode });
        const error = new SymphonyError("turn_failed", "turn failed");
        if (!currentTurn) {
          pendingTurnTerminal = { kind: "failed", error };
          return;
        }
        failCurrentTurn(error);
        return;
      }
      if (method.includes("turn/cancelled")) {
        emit({ event: "turn_cancelled", turn_id: turnIdForEvent, usage, rate_limits: rateLimits, error_code: errorCode });
        const error = new SymphonyError("turn_cancelled", "turn cancelled");
        if (!currentTurn) {
          pendingTurnTerminal = { kind: "cancelled", error };
          return;
        }
        failCurrentTurn(error);
        return;
      }
      if (method.includes("requestUserInput")) {
        emit({ event: "turn_input_required", turn_id: turnIdForEvent, usage, rate_limits: rateLimits, error_code: errorCode });
        const error = new SymphonyError("turn_input_required", "user input required");
        if (!currentTurn) {
          pendingTurnTerminal = { kind: "input_required", error };
          return;
        }
        failCurrentTurn(error);
        return;
      }

      if (usage || rateLimits) {
        emit({ event: "notification", turn_id: turnIdForEvent, usage, rate_limits: rateLimits });
      } else {
        emit({ event: "notification", turn_id: turnIdForEvent, message: method });
      }
    };

    const extractToolCall = (
      message: RpcMessage
    ): { name: string; input: unknown; callId: string | number | undefined } | null => {
      const params = (message.params ?? {}) as Record<string, unknown>;
      const rawName =
        (params.name as string | undefined) ??
        (params.tool_name as string | undefined) ??
        ((params.tool as Record<string, unknown> | undefined)?.name as string | undefined);
      if (!rawName) {
        return null;
      }
      const input =
        params.input ??
        params.arguments ??
        params.args ??
        ((params.tool as Record<string, unknown> | undefined)?.input as unknown);
      const callId =
        (params.id as string | number | undefined) ??
        (params.toolCallId as string | number | undefined) ??
        message.id;
      return { name: rawName, input, callId };
    };

    const handleIncoming = async (line: string) => {
      let message: RpcMessage;
      try {
        message = JSON.parse(line) as RpcMessage;
      } catch (error) {
        emit({ event: "malformed", message: String(error) });
        return;
      }

      if (typeof message.id === "number" && pending.has(message.id)) {
        const req = pending.get(message.id)!;
        pending.delete(message.id);
        clearTimeout(req.timer);
        if (message.error) {
          req.reject(new SymphonyError("response_error", JSON.stringify(message.error)));
          return;
        }
        req.resolve(message);
        return;
      }

      // Handle server->client requests.
      if ((typeof message.id === "number" || typeof message.id === "string") && message.method) {
        const method = message.method;
        if (method.toLowerCase().includes("approval")) {
          respond(message.id, { approved: true });
          emit({ event: "approval_auto_approved" });
          return;
        }
        if (method.includes("item/tool/call")) {
          const parsed = extractToolCall(message);
          if (!parsed) {
            respond(message.id, { success: false, error: "unsupported_tool_call" });
            emit({ event: "unsupported_tool_call", message: "missing_tool_name" });
            return;
          }
          if (!options.onToolCall) {
            respond(message.id, { success: false, error: "unsupported_tool_call" });
            emit({ event: "unsupported_tool_call", message: parsed.name });
            return;
          }
          try {
            const result = await options.onToolCall(parsed.name, parsed.input);
            respond(message.id, result);
          } catch (error) {
            respond(message.id, { success: false, error: String(error) });
          }
          return;
        }
      }

      if (message.method) {
        await handleNotification(message);
        return;
      }

      emit({ event: "other_message" });
    };

    proc.stdout.on("data", (chunk) => {
      readBuffer += chunk.toString("utf8");
      while (true) {
        const idx = readBuffer.indexOf("\n");
        if (idx < 0) {
          break;
        }
        const line = readBuffer.slice(0, idx).trim();
        readBuffer = readBuffer.slice(idx + 1);
        if (!line) {
          continue;
        }
        void handleIncoming(line);
      }
    });

    proc.stderr.on("data", (chunk) => {
      this.#logger.warn("codex_stderr", { message: chunk.toString("utf8").slice(0, 500) });
    });

    proc.on("error", (error) => {
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(error);
        pending.delete(id);
      }
      failCurrentTurn(new SymphonyError("port_exit", String(error)));
    });

    proc.on("close", () => {
      closed = true;
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new SymphonyError("port_exit", "app-server process exited"));
        pending.delete(id);
      }
      failCurrentTurn(new SymphonyError("port_exit", "app-server process exited"));
    });

    try {
      await request("initialize", {
        clientInfo: { name: "symphony", version: "0.1.0" },
        capabilities: {}
      });
      writeJson({ method: "initialized", params: {} });
      const threadResp = await request("thread/start", {
        approvalPolicy,
        sandbox: threadSandbox,
        cwd: options.workspacePath,
        tools: options.tools ?? []
      });

      const threadPayload = threadResp.result as Record<string, unknown> | undefined;
      const thread = (threadPayload?.thread as Record<string, unknown> | undefined) ?? {};
      threadId = String(thread.id ?? "");
      if (!threadId) {
        throw new SymphonyError("response_error", "missing thread id");
      }

      emit({
        event: "session_started",
        message: `${threadId}`,
        usage: undefined
      });

      const runTurn = async (params: {
        prompt: string;
        title: string;
        onEvent: (event: AgentEvent) => void;
        signal?: AbortSignal;
      }): Promise<{ turnId: string }> => {
        params.onEvent({ event: "notification", timestamp: new Date().toISOString(), message: "turn_started" });
        return new Promise<{ turnId: string }>((resolve, reject) => {
          const timeout = setTimeout(() => {
            failCurrentTurn(new SymphonyError("turn_timeout", "turn timed out"));
          }, this.#config.turnTimeoutMs);

          currentTurn = { resolve, reject: (error) => reject(error), turnId: "", timeout };

          if (params.signal) {
            params.signal.addEventListener(
              "abort",
              () => failCurrentTurn(new SymphonyError("turn_cancelled", "turn cancelled by reconciliation")),
              { once: true }
            );
          }

          void (async () => {
            try {
              const turnResponse = await request("turn/start", {
                threadId,
                input: [{ type: "text", text: params.prompt }],
                cwd: options.workspacePath,
                title: params.title,
                approvalPolicy,
                sandboxPolicy: { type: turnSandbox }
              });
              const turnResult = turnResponse.result as Record<string, unknown> | undefined;
              const turnObj = (turnResult?.turn as Record<string, unknown> | undefined) ?? {};
              if (currentTurn) {
                currentTurn.turnId = String(turnObj.id ?? "");
              }

              if (pendingTurnTerminal) {
                const pending = pendingTurnTerminal;
                pendingTurnTerminal = null;
                if (pending.kind === "completed") {
                  completeCurrentTurn();
                } else {
                  failCurrentTurn(pending.error);
                }
              }
            } catch (error) {
              failCurrentTurn(asError(error));
            }
          })();
        });
      };

      const stop = async () => {
        if (closing || closed) {
          return;
        }
        closing = true;
        proc.kill("SIGTERM");
        await delay(200);
        if (!closed) {
          proc.kill("SIGKILL");
        }
      };

      // Run first turn immediately only when requested by worker; session is ready here.
      return { threadId, runTurn, stop };
    } catch (error) {
      emit({ event: "startup_failed", message: String(error) });
      proc.kill("SIGTERM");
      throw error;
    }
  }
}
