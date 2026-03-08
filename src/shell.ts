import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { SymphonyError } from "./errors.js";
import type { Logger } from "./types.js";

const execFileAsync = promisify(execFile);

export interface ShellCommand {
  command: string;
  args: string[];
}

function normalizeWindowsCommand(rawCommand: string): string {
  const trimmed = rawCommand.trim();
  if (/^codex(\s|$)/i.test(trimmed) && !/^codex\.cmd(\s|$)/i.test(trimmed)) {
    return `codex.cmd${trimmed.slice(5)}`;
  }
  return trimmed;
}

export async function hasCommand(name: string): Promise<boolean> {
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    await execFileAsync(probe, [name]);
    return true;
  } catch {
    return false;
  }
}

export async function getCodexLaunchCommand(
  rawCommand: string,
  logger: Logger,
  launchMode: "strict" | "compatible"
): Promise<ShellCommand> {
  if (process.platform !== "win32") {
    return { command: "bash", args: ["-lc", rawCommand] };
  }

  if (launchMode === "strict") {
    const hasBash = await hasCommand("bash");
    if (!hasBash) {
      throw new SymphonyError("codex_not_found", "strict launch mode requires bash on Windows");
    }
    return { command: "bash", args: ["-lc", rawCommand] };
  }

  logger.warn("using_cmd_launcher_on_windows_compat_mode");
  const command = normalizeWindowsCommand(rawCommand);
  return { command: "cmd.exe", args: ["/d", "/s", "/c", command] };
}

export async function runHookScript(
  script: string,
  cwd: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; code: number }> {
  const cmd =
    process.platform === "win32"
      ? { command: "powershell", args: ["-NoProfile", "-Command", script] }
      : { command: "sh", args: ["-lc", script] };

  return new Promise((resolve, reject) => {
    const child = spawn(cmd.command, cmd.args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let done = false;

    const timeout = setTimeout(() => {
      if (done) {
        return;
      }
      done = true;
      child.kill("SIGTERM");
      reject(new Error("hook_timeout"));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timeout);
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
}
