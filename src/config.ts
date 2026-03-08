import os from "node:os";
import path from "node:path";
import { SymphonyError } from "./errors.js";
import { hasPathSeparators, normalizeStateKey, resolveEnvValue, resolvePathLike } from "./path-utils.js";
import type { ServiceConfig } from "./types.js";

const DEFAULTS = {
  trackerEndpoint: "https://api.linear.app/graphql",
  trackerActiveStates: ["Todo", "In Progress"],
  trackerTerminalStates: ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"],
  pollIntervalMs: 30_000,
  workspaceRoot: path.join(os.tmpdir(), "symphony_workspaces"),
  hooksTimeoutMs: 60_000,
  maxConcurrentAgents: 10,
  maxTurns: 20,
  maxRetryBackoffMs: 300_000,
  codexCommand: "codex app-server",
  codexLaunchMode: "strict" as const,
  codexApprovalPolicy: "full-auto",
  codexThreadSandbox: "workspace-write",
  codexTurnSandboxPolicy: "workspace-write",
  codexEnableLinearGraphqlTool: false,
  codexTurnTimeoutMs: 3_600_000,
  codexReadTimeoutMs: 5_000,
  codexStallTimeoutMs: 300_000
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parsePositiveInt(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 0 ? Math.floor(raw) : fallback;
  }

  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return fallback;
}

function parseIntAllowZero(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.floor(raw);
  }

  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function parseBoolean(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return fallback;
}

function parseStates(raw: unknown, fallback: string[]): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
  }

  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return fallback;
}

function parseStrings(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

function parseStateLimits(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const output: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const parsed = parsePositiveInt(value, -1);
    if (parsed > 0) {
      output[normalizeStateKey(key)] = parsed;
    }
  }
  return output;
}

function resolveApiKey(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return process.env.LINEAR_API_KEY ?? "";
  }
  if (raw.startsWith("$")) {
    return resolveEnvValue(raw);
  }
  return raw;
}

function resolveWorkspaceRoot(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return path.resolve(DEFAULTS.workspaceRoot);
  }

  const candidate = raw.trim();
  if (candidate.startsWith("$") || candidate.startsWith("~") || hasPathSeparators(candidate)) {
    return resolvePathLike(candidate);
  }

  return path.resolve(candidate);
}

export function resolveConfig(rawConfig: Record<string, unknown>): ServiceConfig {
  const tracker = asRecord(rawConfig.tracker);
  const polling = asRecord(rawConfig.polling);
  const workspace = asRecord(rawConfig.workspace);
  const hooks = asRecord(rawConfig.hooks);
  const agent = asRecord(rawConfig.agent);
  const codex = asRecord(rawConfig.codex);
  const server = asRecord(rawConfig.server);
  const verification = asRecord(rawConfig.verification);

  const trackerWriteback = asRecord(tracker.writeback);

  const cfg: ServiceConfig = {
    tracker: {
      kind: typeof tracker.kind === "string" ? tracker.kind : "",
      endpoint: typeof tracker.endpoint === "string" ? tracker.endpoint : DEFAULTS.trackerEndpoint,
      apiKey: resolveApiKey(tracker.api_key),
      projectSlug: typeof tracker.project_slug === "string" ? tracker.project_slug : "",
      activeStates: parseStates(tracker.active_states, DEFAULTS.trackerActiveStates),
      terminalStates: parseStates(tracker.terminal_states, DEFAULTS.trackerTerminalStates),
      writeback: {
        enabled: parseBoolean(trackerWriteback.enabled, false),
        doneState: typeof trackerWriteback.done_state === "string" ? trackerWriteback.done_state : null
      }
    },
    polling: {
      intervalMs: parsePositiveInt(polling.interval_ms, DEFAULTS.pollIntervalMs)
    },
    workspace: {
      root: resolveWorkspaceRoot(workspace.root)
    },
    hooks: {
      afterCreate: typeof hooks.after_create === "string" ? hooks.after_create : null,
      beforeRun: typeof hooks.before_run === "string" ? hooks.before_run : null,
      afterRun: typeof hooks.after_run === "string" ? hooks.after_run : null,
      beforeRemove: typeof hooks.before_remove === "string" ? hooks.before_remove : null,
      timeoutMs: parsePositiveInt(hooks.timeout_ms, DEFAULTS.hooksTimeoutMs)
    },
    agent: {
      maxConcurrentAgents: parsePositiveInt(agent.max_concurrent_agents, DEFAULTS.maxConcurrentAgents),
      maxTurns: parsePositiveInt(agent.max_turns, DEFAULTS.maxTurns),
      maxRetryBackoffMs: parsePositiveInt(agent.max_retry_backoff_ms, DEFAULTS.maxRetryBackoffMs),
      maxConcurrentAgentsByState: parseStateLimits(agent.max_concurrent_agents_by_state)
    },
    codex: {
      command: typeof codex.command === "string" && codex.command.trim() ? codex.command : DEFAULTS.codexCommand,
      launchMode:
        codex.launch_mode === "compatible" || codex.launch_mode === "strict"
          ? codex.launch_mode
          : DEFAULTS.codexLaunchMode,
      approvalPolicy:
        typeof codex.approval_policy === "string" && codex.approval_policy.trim()
          ? codex.approval_policy
          : DEFAULTS.codexApprovalPolicy,
      threadSandbox:
        typeof codex.thread_sandbox === "string" && codex.thread_sandbox.trim()
          ? codex.thread_sandbox
          : DEFAULTS.codexThreadSandbox,
      turnSandboxPolicy:
        typeof codex.turn_sandbox_policy === "string" && codex.turn_sandbox_policy.trim()
          ? codex.turn_sandbox_policy
          : DEFAULTS.codexTurnSandboxPolicy,
      enableLinearGraphqlTool: parseBoolean(codex.enable_linear_graphql_tool, DEFAULTS.codexEnableLinearGraphqlTool),
      turnTimeoutMs: parsePositiveInt(codex.turn_timeout_ms, DEFAULTS.codexTurnTimeoutMs),
      readTimeoutMs: parsePositiveInt(codex.read_timeout_ms, DEFAULTS.codexReadTimeoutMs),
      stallTimeoutMs: parseIntAllowZero(codex.stall_timeout_ms, DEFAULTS.codexStallTimeoutMs)
    },
    server: {
      port: server.port === undefined || server.port === null ? null : parseIntAllowZero(server.port, 0)
    },
    verification: {
      requiredKinds: parseStrings(verification.required_kinds),
      workspaceSignals: parseStrings(verification.workspace_signals)
    }
  };

  return cfg;
}

export function validateDispatchConfig(config: ServiceConfig): void {
  if (!config.tracker.kind || config.tracker.kind !== "linear") {
    throw new SymphonyError("unsupported_tracker_kind", "tracker.kind must be 'linear'");
  }
  if (!config.tracker.apiKey) {
    throw new SymphonyError("missing_tracker_api_key", "tracker.api_key is required");
  }
  if (!config.tracker.projectSlug) {
    throw new SymphonyError("missing_tracker_project_slug", "tracker.project_slug is required");
  }
  if (!config.codex.command.trim()) {
    throw new SymphonyError("missing_codex_command", "codex.command must be non-empty");
  }
}
