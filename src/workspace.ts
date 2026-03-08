import fs from "node:fs/promises";
import path from "node:path";
import { SymphonyError } from "./errors.js";
import { sanitizeWorkspaceKey } from "./path-utils.js";
import { runHookScript } from "./shell.js";
import type { HooksConfig, Logger, WorkspaceConfig } from "./types.js";

function assertWorkspacePath(workspaceRoot: string, workspacePath: string): void {
  const root = path.resolve(workspaceRoot);
  const candidate = path.resolve(workspacePath);
  if (!candidate.startsWith(root + path.sep) && candidate !== root) {
    throw new SymphonyError("invalid_workspace_cwd", "workspace path escapes workspace root", {
      root,
      candidate
    });
  }
}

async function statOrNull(filePath: string): Promise<Awaited<ReturnType<typeof fs.stat>> | null> {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

export interface WorkspaceInfo {
  workspacePath: string;
  workspaceKey: string;
  createdNow: boolean;
}

export class WorkspaceManager {
  readonly #workspace: WorkspaceConfig;
  readonly #hooks: HooksConfig;
  readonly #logger: Logger;

  constructor(workspace: WorkspaceConfig, hooks: HooksConfig, logger: Logger) {
    this.#workspace = workspace;
    this.#hooks = hooks;
    this.#logger = logger;
  }

  getWorkspacePath(identifier: string): string {
    const workspaceKey = sanitizeWorkspaceKey(identifier);
    const candidate = path.resolve(this.#workspace.root, workspaceKey);
    assertWorkspacePath(this.#workspace.root, candidate);
    return candidate;
  }

  async createForIssue(identifier: string): Promise<WorkspaceInfo> {
    const workspaceKey = sanitizeWorkspaceKey(identifier);
    const workspacePath = this.getWorkspacePath(identifier);
    const stat = await statOrNull(workspacePath);
    if (stat && !stat.isDirectory()) {
      throw new SymphonyError("invalid_workspace_cwd", "workspace path exists and is not a directory", {
        workspacePath
      });
    }

    const createdNow = !stat;
    if (createdNow) {
      await fs.mkdir(workspacePath, { recursive: true });
      await this.runHook("after_create", this.#hooks.afterCreate, workspacePath, true);
    }

    // Clean known ephemeral directories before run prep.
    await Promise.all(
      ["tmp", ".elixir_ls"].map(async (name) => {
        const p = path.join(workspacePath, name);
        await fs.rm(p, { recursive: true, force: true });
      })
    );

    return { workspacePath, workspaceKey, createdNow };
  }

  async removeWorkspace(identifier: string): Promise<void> {
    const workspacePath = this.getWorkspacePath(identifier);
    const stat = await statOrNull(workspacePath);
    if (!stat) {
      return;
    }

    await this.runHook("before_remove", this.#hooks.beforeRemove, workspacePath, false);
    try {
      await fs.rm(workspacePath, { recursive: true, force: true });
    } catch (error) {
      this.#logger.warn("workspace_remove_failed", { workspacePath, error: String(error) });
    }
  }

  async runBeforeRun(workspacePath: string): Promise<void> {
    await this.runHook("before_run", this.#hooks.beforeRun, workspacePath, true);
  }

  async runAfterRun(workspacePath: string): Promise<void> {
    await this.runHook("after_run", this.#hooks.afterRun, workspacePath, false);
  }

  async runHook(name: string, script: string | null, cwd: string, fatal: boolean): Promise<void> {
    if (!script) {
      return;
    }

    this.#logger.info("hook_started", { hook: name, cwd });
    try {
      const result = await runHookScript(script, cwd, this.#hooks.timeoutMs);
      if (result.code !== 0) {
        throw new Error(`hook_exit_nonzero:${result.code}`);
      }
      this.#logger.info("hook_completed", { hook: name });
    } catch (error) {
      this.#logger.error("hook_failed", { hook: name, error: String(error) });
      if (fatal) {
        throw new SymphonyError("hook_error", `hook ${name} failed`, error);
      }
    }
  }
}
