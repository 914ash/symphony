import { describe, expect, it } from "vitest";
import { loadWorkflow } from "../src/workflow.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("workflow loader", () => {
  it("loads front matter and prompt body", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "symphony-workflow-"));
    const file = path.join(dir, "WORKFLOW.md");
    await writeFile(
      file,
      `---
tracker:
  kind: linear
---
Hello {{ issue.identifier }}`
    );

    const workflow = await loadWorkflow(file);
    expect(workflow.config).toEqual({ tracker: { kind: "linear" } });
    expect(workflow.promptTemplate).toBe("Hello {{ issue.identifier }}");
  });
});

