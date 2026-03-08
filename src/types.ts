export interface Issue {
  id: string;
  identifier: string;
  title: string;
  state: string;
  description?: string | null;
  priority?: number | null;
  labels: string[];
  blockedBy: Array<{ id: string; identifier: string; state: string }>;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface WorkflowDefinition {
  path: string;
  config: Record<string, unknown>;
  promptTemplate: string;
}

export interface TrackerConfig {
  kind: string;
  endpoint: string;
  apiKey: string;
  projectSlug: string;
  activeStates: string[];
  terminalStates: string[];
  writeback: TrackerWritebackConfig;
}

export interface TrackerWritebackConfig {
  enabled: boolean;
  doneState: string | null;
}

export interface VerificationConfig {
  requiredKinds: string[];
  workspaceSignals: string[];
}

export interface PollingConfig {
  intervalMs: number;
}

export interface WorkspaceConfig {
  root: string;
}

export interface HooksConfig {
  afterCreate: string | null;
  beforeRun: string | null;
  afterRun: string | null;
  beforeRemove: string | null;
  timeoutMs: number;
}

export interface AgentConfig {
  maxConcurrentAgents: number;
  maxTurns: number;
  maxRetryBackoffMs: number;
  maxConcurrentAgentsByState: Record<string, number>;
}

export interface CodexConfig {
  command: string;
  launchMode: "strict" | "compatible";
  approvalPolicy: string;
  threadSandbox: string;
  turnSandboxPolicy: string;
  enableLinearGraphqlTool: boolean;
  turnTimeoutMs: number;
  readTimeoutMs: number;
  stallTimeoutMs: number;
}

export interface ServerConfig {
  port: number | null;
}

export interface ServiceConfig {
  tracker: TrackerConfig;
  polling: PollingConfig;
  workspace: WorkspaceConfig;
  hooks: HooksConfig;
  agent: AgentConfig;
  codex: CodexConfig;
  server: ServerConfig;
  verification: VerificationConfig;
}

export interface RetryEntry {
  issueId: string;
  issueIdentifier: string;
  attempt: number;
  dueAtMs: number;
  error?: string;
  timer: NodeJS.Timeout;
}

export interface RunningEntry {
  issue: Issue;
  issueIdentifier: string;
  retryAttempt: number;
  turnCount: number;
  startedAt: string;
  lastCodexTimestamp: string | null;
  lastCodexEvent: string | null;
  lastCodexMessage: string | null;
  threadId: string | null;
  sessionId: string | null;
  lastTurnId: string | null;
  codexAppServerPid: number | null;
  codexInputTokens: number;
  codexOutputTokens: number;
  codexTotalTokens: number;
  lastReportedInputTokens: number;
  lastReportedOutputTokens: number;
  lastReportedTotalTokens: number;
  recentEvents: Array<{ at: string; event: string; message: string | null }>;
  cancel?: (reason: string) => void;
  writebackStatus?: WritebackStatus;
  writebackError?: string;
  lastWorkerResult?: WorkerResult;
}

export type WritebackStatus = "pending" | "skipped" | "in_progress" | "completed" | "failed" | "partial";

export interface CodexTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  secondsRunning: number;
}

export interface RuntimeState {
  running: Map<string, RunningEntry>;
  claimed: Set<string>;
  retryAttempts: Map<string, RetryEntry>;
  completed: Set<string>;
  codexTotals: CodexTotals;
  codexRateLimits: unknown;
  globalEvents: Array<{ at: string; event: string; message: string; issue_identifier: string }>;
}

export interface WorkerResult {
  turnsExecuted: number;
  sessionId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitReason: WorkerExitReason;
  verifications: VerificationRecord[];
}

export interface VerificationRecord {
  kind: string;
  passed: boolean;
  output?: string;
  at: string;
}

export type WorkerExitReason =
  | "normal"
  | "failed"
  | "timeout"
  | "stalled"
  | "cancelled"
  | "max_turns"
  | "state_changed";

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
}
