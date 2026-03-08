import os from "node:os";
import path from "node:path";

export function normalizeStateKey(state: string): string {
  return state.trim().toLowerCase();
}

export function expandHome(value: string): string {
  if (!value.startsWith("~")) {
    return value;
  }
  return path.join(os.homedir(), value.slice(1));
}

export function resolveEnvValue(raw: string): string {
  if (!raw.startsWith("$")) {
    return raw;
  }

  const key = raw.slice(1).trim();
  return process.env[key] ?? "";
}

export function hasPathSeparators(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

export function resolvePathLike(value: string): string {
  let result = value;
  result = expandHome(result);

  if (result.startsWith("$")) {
    result = resolveEnvValue(result);
  } else {
    result = result.replace(/\$([A-Z0-9_]+)/gi, (_, key: string) => process.env[key] ?? "");
  }

  return path.resolve(result);
}

export function sanitizeWorkspaceKey(identifier: string): string {
  return identifier.replace(/[^A-Za-z0-9._-]/g, "_");
}

