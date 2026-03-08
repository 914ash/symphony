import { SymphonyError } from "./errors.js";
import type { Issue, Logger, ServiceConfig } from "./types.js";

export interface TrackerAdapter {
  fetchCandidateIssues(states?: string[]): Promise<Issue[]>;
  fetchIssuesByStates(stateNames: string[]): Promise<Issue[]>;
  fetchIssueStatesByIds(issueIds: string[]): Promise<Array<Pick<Issue, "id" | "state" | "identifier">>>;
  createIssueComment(issueId: string, body: string): Promise<void>;
  markIssueCompleted(issueId: string, doneStateName: string): Promise<void>;
  resolveDoneStateId(doneStateName: string): Promise<string | null>;
}

interface GraphQlResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  priority?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  state?: { name?: string | null } | null;
  labels?: { nodes?: Array<{ name?: string | null }> } | null;
  inverseRelations?: {
    nodes?: Array<{
      type?: string | null;
      relatedIssue?: { id?: string | null; identifier?: string | null; state?: { name?: string | null } | null } | null;
    }>;
  } | null;
}

function toIsoOrNull(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}

function normalizeIssue(node: LinearIssueNode): Issue {
  const labels = (node.labels?.nodes ?? [])
    .map((entry) => (entry?.name ?? "").toLowerCase().trim())
    .filter((entry) => entry.length > 0);

  const blockedBy = (node.inverseRelations?.nodes ?? [])
    .filter((rel) => rel?.type?.toLowerCase() === "blocks")
    .map((rel) => rel.relatedIssue)
    .filter(Boolean)
    .map((issue) => ({
      id: issue!.id ?? "",
      identifier: issue!.identifier ?? "",
      state: issue!.state?.name ?? ""
    }))
    .filter((entry) => entry.id && entry.identifier && entry.state);

  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    description: node.description ?? null,
    state: node.state?.name ?? "",
    priority: Number.isInteger(node.priority) ? (node.priority as number) : null,
    labels,
    blockedBy,
    createdAt: toIsoOrNull(node.createdAt),
    updatedAt: toIsoOrNull(node.updatedAt)
  };
}

function queryForCandidates(): string {
  return `
query CandidateIssues($projectSlug: String!, $states: [String!], $first: Int!, $after: String) {
  issues(
    filter: {
      project: { slugId: { eq: $projectSlug } }
      state: { name: { in: $states } }
    }
    first: $first
    after: $after
    orderBy: createdAt
  ) {
    nodes {
      id
      identifier
      title
      description
      priority
      createdAt
      updatedAt
      state { name }
      labels { nodes { name } }
      inverseRelations {
        nodes {
          type
          relatedIssue {
            id
            identifier
            state { name }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
}

function queryForStatesByIds(): string {
  return `
query IssueStates($ids: [ID!]) {
  issues(filter: { id: { in: $ids } }) {
    nodes {
      id
      identifier
      state { name }
    }
  }
}`;
}

function queryForWorkflowStates(): string {
  return `
query workflowStates {
  workflowStates {
    nodes {
      id
      name
    }
  }
}`;
}

function mutationCreateComment(): string {
  return `
mutation commentCreate($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) {
    success
  }
}`;
}

function mutationUpdateIssue(): string {
  return `
mutation issueUpdate($issueId: String!, $stateId: String!) {
  issueUpdate(id: $issueId, input: { stateId: $stateId }) {
    success
  }
}`;
}

export class LinearTrackerAdapter implements TrackerAdapter {
  #config: ServiceConfig;
  readonly #logger: Logger;
  #stateCache = new Map<string, string>();

  constructor(config: ServiceConfig, logger: Logger) {
    this.#config = config;
    this.#logger = logger;
  }

  updateConfig(config: ServiceConfig): void {
    this.#config = config;
  }

  async #graphql<T>(query: string, variables: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(this.#config.tracker.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: this.#config.tracker.apiKey
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new SymphonyError("linear_api_status", `linear API returned status ${response.status}`);
      }

      const payload = (await response.json()) as GraphQlResponse<T>;
      if (payload.errors && payload.errors.length > 0) {
        throw new SymphonyError("linear_graphql_errors", payload.errors.map((err) => err.message).join("; "));
      }
      if (!payload.data) {
        throw new SymphonyError("linear_unknown_payload", "linear API response did not include data");
      }
      return payload.data;
    } catch (error) {
      if (error instanceof SymphonyError) {
        throw error;
      }
      throw new SymphonyError("linear_api_request", "failed linear graphql request", error);
    } finally {
      clearTimeout(timeout);
    }
  }

  async fetchCandidateIssues(states = this.#config.tracker.activeStates): Promise<Issue[]> {
    const out: Issue[] = [];
    let after: string | null = null;

    while (true) {
      const data: {
        issues?: {
          nodes?: LinearIssueNode[];
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        };
      } = await this.#graphql<{
        issues?: {
          nodes?: LinearIssueNode[];
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        };
      }>(queryForCandidates(), {
        projectSlug: this.#config.tracker.projectSlug,
        states,
        first: 50,
        after
      });

      const nodes = data.issues?.nodes ?? [];
      for (const node of nodes) {
        const normalized = normalizeIssue(node);
        if (normalized.id && normalized.identifier && normalized.title && normalized.state) {
          out.push(normalized);
        }
      }

      const pageInfo: { hasNextPage?: boolean; endCursor?: string | null } | undefined = data.issues?.pageInfo;
      if (!pageInfo?.hasNextPage) {
        break;
      }
      if (!pageInfo.endCursor) {
        throw new SymphonyError("linear_missing_end_cursor", "pagination reported next page but no endCursor");
      }
      after = pageInfo.endCursor;
    }

    return out;
  }

  async fetchIssuesByStates(stateNames: string[]): Promise<Issue[]> {
    if (stateNames.length === 0) {
      return [];
    }

    return this.fetchCandidateIssues(stateNames);
  }

  async fetchIssueStatesByIds(issueIds: string[]): Promise<Array<Pick<Issue, "id" | "state" | "identifier">>> {
    if (issueIds.length === 0) {
      return [];
    }

    const data = await this.#graphql<{
      issues?: { nodes?: Array<{ id?: string; identifier?: string; state?: { name?: string } | null }> };
    }>(queryForStatesByIds(), { ids: issueIds });

    const nodes = data.issues?.nodes ?? [];
    const mapped = nodes
      .map((node) => ({
        id: node.id ?? "",
        identifier: node.identifier ?? "",
        state: node.state?.name ?? ""
      }))
      .filter((node) => node.id && node.identifier && node.state);

    this.#logger.debug("tracker state refresh completed", { count: mapped.length });
    return mapped;
  }

  async createIssueComment(issueId: string, body: string): Promise<void> {
    await this.#graphql<{ commentCreate: { success: boolean } }>(mutationCreateComment(), { issueId, body });
    this.#logger.info("tracker_comment_created", { issueId });
  }

  async markIssueCompleted(issueId: string, doneStateName: string): Promise<void> {
    const stateId = await this.resolveDoneStateId(doneStateName);
    if (!stateId) {
      throw new SymphonyError("tracker_unknown_done_state", `could not resolve state ID for name: ${doneStateName}`);
    }

    await this.#graphql<{ issueUpdate: { success: boolean } }>(mutationUpdateIssue(), { issueId, stateId });
    this.#logger.info("tracker_issue_marked_completed", { issueId, stateName: doneStateName });
  }

  async resolveDoneStateId(doneStateName: string): Promise<string | null> {
    if (this.#stateCache.has(doneStateName)) {
      return this.#stateCache.get(doneStateName)!;
    }

    const data = await this.#graphql<{ workflowStates: { nodes: Array<{ id: string; name: string }> } }>(
      queryForWorkflowStates(),
      {}
    );

    const nodes = data.workflowStates?.nodes ?? [];
    for (const node of nodes) {
      this.#stateCache.set(node.name, node.id);
    }

    return this.#stateCache.get(doneStateName) ?? null;
  }
}
