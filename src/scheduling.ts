import { normalizeStateKey } from "./path-utils.js";
import type { Issue, RuntimeState, ServiceConfig } from "./types.js";

function prioritySortValue(priority: number | null | undefined): number {
  if (!Number.isInteger(priority)) {
    return Number.POSITIVE_INFINITY;
  }
  return priority as number;
}

export function sortIssuesForDispatch(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    const pA = prioritySortValue(a.priority);
    const pB = prioritySortValue(b.priority);
    if (pA !== pB) {
      return pA - pB;
    }

    const cA = a.createdAt ? new Date(a.createdAt).getTime() : Number.POSITIVE_INFINITY;
    const cB = b.createdAt ? new Date(b.createdAt).getTime() : Number.POSITIVE_INFINITY;
    if (cA !== cB) {
      return cA - cB;
    }

    return a.identifier.localeCompare(b.identifier);
  });
}

export function availableGlobalSlots(config: ServiceConfig, state: RuntimeState): number {
  return Math.max(config.agent.maxConcurrentAgents - state.running.size, 0);
}

function countRunningByState(state: RuntimeState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of state.running.values()) {
    const key = normalizeStateKey(entry.issue.state);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function hasAvailableStateSlot(issueState: string, config: ServiceConfig, state: RuntimeState): boolean {
  const normalized = normalizeStateKey(issueState);
  const current = countRunningByState(state)[normalized] ?? 0;
  const configured = config.agent.maxConcurrentAgentsByState[normalized];
  const limit = configured ?? config.agent.maxConcurrentAgents;
  return current < limit;
}

export function shouldDispatchIssue(issue: Issue, config: ServiceConfig, state: RuntimeState): boolean {
  if (!issue.id || !issue.identifier || !issue.title || !issue.state) {
    return false;
  }

  const active = new Set(config.tracker.activeStates.map((stateName) => stateName.toLowerCase()));
  const terminal = new Set(config.tracker.terminalStates.map((stateName) => stateName.toLowerCase()));
  const currentState = issue.state.toLowerCase();

  if (!active.has(currentState) || terminal.has(currentState)) {
    return false;
  }
  if (state.running.has(issue.id) || state.claimed.has(issue.id)) {
    return false;
  }
  if (availableGlobalSlots(config, state) <= 0) {
    return false;
  }
  if (!hasAvailableStateSlot(issue.state, config, state)) {
    return false;
  }

  if (currentState === "todo") {
    const blockers = issue.blockedBy ?? [];
    if (
      blockers.some((blocker) => {
        const stateName = blocker.state.toLowerCase();
        return !terminal.has(stateName);
      })
    ) {
      return false;
    }
  }

  return true;
}

export function retryDelayMs(attempt: number, isContinuation: boolean, maxBackoffMs: number): number {
  if (isContinuation) {
    return 1_000;
  }
  return Math.min(10_000 * 2 ** Math.max(attempt - 1, 0), maxBackoffMs);
}

