import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { SymphonyError } from "./errors.js";
import type { WorkflowDefinition } from "./types.js";

function splitFrontMatter(input: string): { rawConfig: Record<string, unknown>; body: string } {
  if (!input.startsWith("---")) {
    return { rawConfig: {}, body: input.trim() };
  }

  const endMarker = "\n---";
  const end = input.indexOf(endMarker, 3);
  if (end < 0) {
    throw new SymphonyError("workflow_parse_error", "front matter opening marker found without closing marker");
  }

  const yamlText = input.slice(4, end).trim();
  const parsed = yamlText.length === 0 ? {} : parseYaml(yamlText);
  if (parsed === null) {
    return { rawConfig: {}, body: input.slice(end + endMarker.length).trim() };
  }

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SymphonyError("workflow_front_matter_not_a_map", "WORKFLOW.md front matter must decode to a map");
  }

  const body = input.slice(end + endMarker.length).trim();
  return { rawConfig: parsed as Record<string, unknown>, body };
}

export function resolveWorkflowPath(explicitPath?: string): string {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }
  return path.resolve(process.cwd(), "WORKFLOW.md");
}

export async function loadWorkflow(pathToWorkflow: string): Promise<WorkflowDefinition> {
  let raw: string;
  try {
    raw = await fs.readFile(pathToWorkflow, "utf8");
  } catch (error) {
    throw new SymphonyError("missing_workflow_file", `unable to read workflow file at ${pathToWorkflow}`, error);
  }

  let parsed: { rawConfig: Record<string, unknown>; body: string };
  try {
    parsed = splitFrontMatter(raw);
  } catch (error) {
    if (error instanceof SymphonyError) {
      throw error;
    }
    throw new SymphonyError("workflow_parse_error", "failed to parse WORKFLOW.md front matter", error);
  }

  return {
    path: pathToWorkflow,
    config: parsed.rawConfig,
    promptTemplate: parsed.body
  };
}

