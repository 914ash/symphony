import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { CodexConfig, Logger } from "../../src/types.js";

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

import { AppServerClient, type AgentEvent } from "../../src/app-server.js";

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
      queueMicrotask(() => this.#emitServerMessage({ id: message.id, result: {} }));
      return;
    }

    if (message.method === "thread/start" && message.id !== undefined) {
      queueMicrotask(() =>
        this.#emitServerMessage({
          id: message.id,
          result: { thread: { id: "thread-1" } }
        })
      );
      return;
    }

    if (message.method === "turn/start" && message.id !== undefined) {
      queueMicrotask(() =>
        this.#emitServerMessage({
          id: "tool-call-1",
          method: "item/tool/call",
          params: { tool_name: "linear_graphql" }
        })
      );
      queueMicrotask(() =>
        this.#emitServerMessage({
          id: message.id,
          result: { turn: { id: "turn-1" } }
        })
      );
      setTimeout(() =>
        this.#emitServerMessage({
          method: "turn/completed",
          params: {}
        }),
      0);
      return;
    }

    if (message.id === "tool-call-1") {
      this.toolResponses.push(message);
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
  enableLinearGraphqlTool: false,
  turnTimeoutMs: 20_000,
  readTimeoutMs: 20_000,
  stallTimeoutMs: 20_000
};

describe("conformance: unsupported dynamic tool calls", () => {
  it("returns unsupported_tool_call and continues running", async () => {
    const fakeProc = new FakeChildProcess();
    spawnMock.mockReturnValue(fakeProc as any);

    const events: AgentEvent[] = [];
    const client = new AppServerClient(codexConfig, logger);

    const session = await client.startSession({
      workspacePath: process.cwd(),
      initialPrompt: "test",
      title: "test",
      onEvent: (event) => events.push(event)
    });

    const turn = await session.runTurn({
      prompt: "Execute turn",
      title: "test",
      onEvent: (event) => events.push(event)
    });

    expect(turn.turnId).toBe("turn-1");
    expect(fakeProc.toolResponses).toHaveLength(1);
    expect(fakeProc.toolResponses[0]).toMatchObject({
      id: "tool-call-1",
      result: { success: false, error: "unsupported_tool_call" }
    });
    expect(events.some((event) => event.event === "unsupported_tool_call")).toBe(true);
    expect(events.some((event) => event.event === "turn_completed")).toBe(true);

    await session.stop();
  });
});
