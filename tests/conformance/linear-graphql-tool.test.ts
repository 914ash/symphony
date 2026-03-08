import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { CodexConfig, Logger } from "../../src/types.js";
import { AppServerClient } from "../../src/app-server.js";
import { executeLinearGraphqlTool } from "../../src/dynamic-tools/linear-graphql.js";

const spawnMock = vi.fn();
const getCodexLaunchCommandMock = vi.fn(async () => ({
  command: "fake-codex",
  args: ["app-server"]
}));

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args)
}));

vi.mock("../../src/shell.js", () => ({
  getCodexLaunchCommand: (...args: unknown[]) => getCodexLaunchCommandMock(...args)
}));

class FakeChildProcess extends EventEmitter {
  pid = 43210;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  toolResponses: Array<Record<string, unknown>> = [];
  #buffer = "";

  stdin = {
    write: (chunk: string) => {
      this.#buffer += String(chunk);
      while (true) {
        const idx = this.#buffer.indexOf("\n");
        if (idx < 0) {
          break;
        }
        const line = this.#buffer.slice(0, idx).trim();
        this.#buffer = this.#buffer.slice(idx + 1);
        if (!line) {
          continue;
        }
        this.#onClientMessage(JSON.parse(line) as Record<string, unknown>);
      }
      return true;
    }
  };

  kill = vi.fn((_signal?: string) => {
    queueMicrotask(() => this.emit("close", 0));
    return true;
  });

  #emitServerMessage(payload: Record<string, unknown>): void {
    this.stdout.emit("data", Buffer.from(`${JSON.stringify(payload)}\n`, "utf8"));
  }

  #onClientMessage(message: Record<string, unknown>): void {
    if (message.method === "initialize" && message.id !== undefined) {
      queueMicrotask(() => this.#emitServerMessage({ id: message.id as number, result: {} }));
      return;
    }
    if (message.method === "thread/start" && message.id !== undefined) {
      queueMicrotask(() =>
        this.#emitServerMessage({ id: message.id as number, result: { thread: { id: "thread-1" } } })
      );
      return;
    }
    if (message.method === "turn/start" && message.id !== undefined) {
      queueMicrotask(() =>
        this.#emitServerMessage({
          id: "tool-call-1",
          method: "item/tool/call",
          params: {
            name: "unknown_tool",
            input: {}
          }
        })
      );
      queueMicrotask(() =>
        this.#emitServerMessage({
          id: message.id as number,
          result: { turn: { id: "turn-1" } }
        })
      );
      queueMicrotask(() =>
        this.#emitServerMessage({
          method: "turn/completed",
          params: {}
        })
      );
      return;
    }
    if (message.id === "tool-call-1" && typeof message.id === "string") {
      this.toolResponses.push(message);
    }
  }
}

class GraphqlChildProcess extends EventEmitter {
  pid = 54321;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  #buffer = "";

  stdin = {
    write: (chunk: string) => {
      this.#buffer += String(chunk);
      while (true) {
        const idx = this.#buffer.indexOf("\n");
        if (idx < 0) {
          break;
        }
        const line = this.#buffer.slice(0, idx).trim();
        this.#buffer = this.#buffer.slice(idx + 1);
        if (!line) {
          continue;
        }
        this.#onClientMessage(JSON.parse(line) as Record<string, unknown>);
      }
      return true;
    }
  };

  kill = vi.fn((_signal?: string) => {
    queueMicrotask(() => this.emit("close", 0));
    return true;
  });

  #emitServerMessage(payload: Record<string, unknown>): void {
    this.stdout.emit("data", Buffer.from(`${JSON.stringify(payload)}\n`, "utf8"));
  }

  #onClientMessage(message: Record<string, unknown>): void {
    if (message.method === "initialize" && message.id !== undefined) {
      queueMicrotask(() => this.#emitServerMessage({ id: message.id as number, result: {} }));
      return;
    }
    if (message.method === "thread/start" && message.id !== undefined) {
      queueMicrotask(() =>
        this.#emitServerMessage({ id: message.id as number, result: { thread: { id: "thread-graphql" } } })
      );
      return;
    }
    if (message.method === "turn/start" && message.id !== undefined) {
      queueMicrotask(() =>
        this.#emitServerMessage({
          id: "tool-call-1",
          method: "item/tool/call",
          params: {
            id: "tc-1",
            name: "linear_graphql",
            input: {
              query: "query One { viewer { id } }"
            }
          }
        })
      );
      queueMicrotask(() =>
        this.#emitServerMessage({
          id: message.id as number,
          result: { turn: { id: "turn-graphql" } }
        })
      );
      queueMicrotask(() => this.#emitServerMessage({ method: "turn/completed", params: {} }));
      return;
    }
  }
}

const logger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
};

const codexConfig: CodexConfig = {
  command: "codex app-server",
  launchMode: "strict",
  approvalPolicy: "full-auto",
  threadSandbox: "workspace-write",
  turnSandboxPolicy: "workspace-write",
  enableLinearGraphqlTool: true,
  turnTimeoutMs: 20_000,
  readTimeoutMs: 20_000,
  stallTimeoutMs: 20_000
};

describe("conformance: linear_graphql tool", () => {
  it("returns unsupported_tool_call for unknown dynamic tool names", async () => {
    const fakeProc = new FakeChildProcess();
    spawnMock.mockReturnValue(fakeProc as any);

    const events: Array<{ event: string; message?: string }> = [];
    const client = new AppServerClient(codexConfig, logger);

    const session = await client.startSession({
      workspacePath: process.cwd(),
      initialPrompt: "test",
      title: "test",
      onEvent: (event) => events.push(event)
    });

    await session.runTurn({
      prompt: "Execute turn",
      title: "test",
      onEvent: () => {}
    });

    expect(fakeProc.toolResponses).toHaveLength(1);
    expect(fakeProc.toolResponses[0]).toMatchObject({
      id: "tool-call-1",
      result: { success: false, error: "unsupported_tool_call" }
    });
    expect(events.some((event) => event.event === "unsupported_tool_call")).toBe(true);
    await session.stop();
  });

  it("passes query and auth through linear_graphql handler", async () => {
    const fakeProc = new GraphqlChildProcess();
    spawnMock.mockReturnValue(fakeProc as any);

    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ data: { viewer: { id: "1" } } }) });
    vi.stubGlobal("fetch", fetchSpy);

    const events: Array<Record<string, unknown>> = [];
    const client = new AppServerClient(
      {
        ...codexConfig,
        command: "codex app-server"
      },
      logger
    );

    const session = await client.startSession({
      workspacePath: process.cwd(),
      initialPrompt: "test",
      title: "test",
      onEvent: (event) => events.push(event),
      onToolCall: async () => {
        return executeLinearGraphqlTool(
          { query: "query One { viewer { id } }" },
          { endpoint: "https://api.linear.app/graphql", apiKey: "TOKEN-OK" }
        );
      }
    });

    const turn = await session.runTurn({
      prompt: "Run GraphQL",
      title: "test",
      onEvent: () => {}
    });

    expect(turn.turnId).toBe("turn-graphql");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "TOKEN-OK"
    });
    const body = JSON.parse(init.body as string);
    expect(body.query).toBe("query One { viewer { id } }");
    expect(body.variables).toEqual({});

    await session.stop();
  });
});
