import { Liquid } from "liquidjs";
import { SymphonyError } from "./errors.js";
import type { Issue } from "./types.js";

const DEFAULT_PROMPT = "You are working on an issue from Linear.";

const engine = new Liquid({
  strictFilters: true,
  strictVariables: true
});

export async function renderPrompt(promptTemplate: string, issue: Issue, attempt: number | null): Promise<string> {
  const source = promptTemplate.trim().length > 0 ? promptTemplate : DEFAULT_PROMPT;
  try {
    return await engine.parseAndRender(source, { issue, attempt });
  } catch (error) {
    throw new SymphonyError("template_render_error", "failed to render prompt template", error);
  }
}

