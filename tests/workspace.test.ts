import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceManager } from "../src/workspace.js";
import { createLogger } from "../src/logger.js";

describe("workspace manager", () => {
  it("sanitizes workspace keys and creates directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "symphony-ws-"));
    const mgr = new WorkspaceManager(
      { root },
      { afterCreate: null, beforeRun: null, afterRun: null, beforeRemove: null, timeoutMs: 1000 },
      createLogger("error")
    );
    const info = await mgr.createForIssue("ABC/1:bad");
    expect(info.workspaceKey).toBe("ABC_1_bad");
    expect(info.workspacePath.startsWith(root)).toBe(true);
  });
});

