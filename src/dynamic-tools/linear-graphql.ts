import { SymphonyError } from "../errors.js";

interface LinearGraphqlToolInput {
  query: string;
  variables?: Record<string, unknown>;
}

function normalizeInput(input: unknown): LinearGraphqlToolInput {
  if (typeof input === "string") {
    return { query: input };
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SymphonyError("linear_graphql_invalid_input", "tool input must be object or query string");
  }

  const obj = input as Record<string, unknown>;
  const query = obj.query;
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new SymphonyError("linear_graphql_invalid_input", "query must be non-empty string");
  }

  const variables = obj.variables;
  if (variables !== undefined && (!variables || typeof variables !== "object" || Array.isArray(variables))) {
    throw new SymphonyError("linear_graphql_invalid_input", "variables must be a JSON object when provided");
  }

  return { query: query.trim(), variables: variables as Record<string, unknown> | undefined };
}

function countOperations(query: string): number {
  const cleaned = query.replace(/#[^\n]*$/gm, "");
  const matches = cleaned.match(/\b(query|mutation|subscription)\b/g);
  if (!matches) {
    // Shorthand query without explicit operation keyword.
    return 1;
  }
  return matches.length;
}

export async function executeLinearGraphqlTool(
  input: unknown,
  opts: { endpoint: string; apiKey: string; timeoutMs?: number }
): Promise<{ success: boolean; data?: unknown; error?: string; response?: unknown }> {
  const payload = normalizeInput(input);
  if (!opts.apiKey) {
    return { success: false, error: "missing_tracker_api_key" };
  }

  if (countOperations(payload.query) !== 1) {
    return { success: false, error: "linear_graphql_invalid_input_multiple_operations" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const response = await fetch(opts.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: opts.apiKey
      },
      body: JSON.stringify({
        query: payload.query,
        variables: payload.variables ?? {}
      }),
      signal: controller.signal
    });

    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      return { success: false, error: "linear_api_status", response: body };
    }

    if (Array.isArray(body.errors) && body.errors.length > 0) {
      return { success: false, error: "linear_graphql_errors", response: body };
    }

    return { success: true, data: body };
  } catch (error) {
    return { success: false, error: `linear_api_request:${String(error)}` };
  } finally {
    clearTimeout(timeout);
  }
}

