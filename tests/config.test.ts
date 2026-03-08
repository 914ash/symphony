import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config.js";

describe("config resolver", () => {
  it("applies defaults and env indirection", () => {
    process.env.TEST_LINEAR_TOKEN = "abc";
    const config = resolveConfig({
      tracker: {
        kind: "linear",
        api_key: "$TEST_LINEAR_TOKEN",
        project_slug: "PROJ"
      }
    });

    expect(config.tracker.endpoint).toBe("https://api.linear.app/graphql");
    expect(config.tracker.apiKey).toBe("abc");
    expect(config.agent.maxConcurrentAgents).toBe(10);
    expect(config.polling.intervalMs).toBe(30000);
  });

  it("parses write-back and verification config", () => {
    const config = resolveConfig({
      tracker: {
        kind: "linear",
        api_key: "abc",
        project_slug: "PROJ",
        writeback: {
          enabled: true,
          done_state: "Verified"
        }
      },
      verification: {
        required_kinds: ["test", "lint"],
        workspace_signals: ["dist/index.js"]
      }
    });

    // testing new fields
    expect(config.tracker.writeback.enabled).toBe(true);
    expect(config.tracker.writeback.doneState).toBe("Verified");
    expect(config.verification.requiredKinds).toEqual(["test", "lint"]);
    expect(config.verification.workspaceSignals).toEqual(["dist/index.js"]);
  });

  it("defaults write-back and verification config", () => {
    const config = resolveConfig({
      tracker: {
        kind: "linear",
        api_key: "abc",
        project_slug: "PROJ"
      }
    });

    expect(config.tracker.writeback.enabled).toBe(false);
    expect(config.verification.requiredKinds).toEqual([]);
    expect(config.verification.workspaceSignals).toEqual([]);
  });
});

