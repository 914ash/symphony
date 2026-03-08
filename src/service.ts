import fs from "node:fs";
import path from "node:path";
import { resolveConfig, validateDispatchConfig } from "./config.js";
import { SymphonyError, asSymphonyError } from "./errors.js";
import { startHttpServer } from "./http-server.js";
import { createLogger } from "./logger.js";
import { Orchestrator } from "./orchestrator.js";
import { LinearTrackerAdapter } from "./tracker.js";
import type { Logger, ServiceConfig, WorkflowDefinition } from "./types.js";
import { loadWorkflow } from "./workflow.js";
import { WorkspaceManager } from "./workspace.js";

export interface SymphonyService {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

async function loadValidated(workflowPath: string): Promise<{ workflow: WorkflowDefinition; config: ServiceConfig }> {
  const workflow = await loadWorkflow(workflowPath);
  const config = resolveConfig(workflow.config);
  validateDispatchConfig(config);
  return { workflow, config };
}

export async function createSymphonyService(options: {
  workflowPath: string;
  portOverride: number | null;
  logLevel?: "debug" | "info" | "warn" | "error";
}): Promise<SymphonyService> {
  const logger = createLogger(options.logLevel ?? "info");
  const initial = await loadValidated(options.workflowPath);
  const tracker = new LinearTrackerAdapter(initial.config, logger);
  const workspaceManager = new WorkspaceManager(initial.config.workspace, initial.config.hooks, logger);
  const orchestrator = new Orchestrator({
    logger,
    tracker,
    config: initial.config,
    workflow: initial.workflow,
    workspaceManager
  });

  let httpServer: Awaited<ReturnType<typeof startHttpServer>> | null = null;
  let watcher: fs.FSWatcher | null = null;
  let lastGoodConfig = initial.config;
  let lastGoodWorkflow = initial.workflow;

  const applyReload = async () => {
    try {
      const reloaded = await loadValidated(options.workflowPath);
      lastGoodConfig = reloaded.config;
      lastGoodWorkflow = reloaded.workflow;
      tracker.updateConfig(reloaded.config);
      orchestrator.applyWorkflow(reloaded.workflow, reloaded.config);
      logger.info("workflow_reload_applied");
    } catch (error) {
      const se = asSymphonyError(error, "workflow_reload_error");
      logger.error("workflow_reload_failed_using_last_known_good", { code: se.code, message: se.message });
      tracker.updateConfig(lastGoodConfig);
      orchestrator.applyWorkflow(lastGoodWorkflow, lastGoodConfig);
    }
  };

  const onSignal = async (signal: string) => {
    logger.warn("shutdown_signal_received", { signal });
    await service.stop();
    process.exit(0);
  };

  const installSignals = () => {
    process.on("SIGINT", () => void onSignal("SIGINT"));
    process.on("SIGTERM", () => void onSignal("SIGTERM"));
  };

  const removeSignals = () => {
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
  };

  const service: SymphonyService = {
    async start() {
      await orchestrator.startupTerminalWorkspaceCleanup();
      await orchestrator.start();
      watcher = fs.watch(path.resolve(options.workflowPath), { persistent: true }, () => {
        void applyReload();
      });

      const selectedPort = options.portOverride ?? initial.config.server.port;
      if (selectedPort !== null && selectedPort !== undefined) {
        httpServer = await startHttpServer({
          orchestrator,
          logger,
          port: selectedPort
        });
      }

      installSignals();
      logger.info("symphony_service_started", { workflow_path: options.workflowPath, port: selectedPort });
    },

    async stop() {
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      if (httpServer) {
        await new Promise<void>((resolve, reject) => {
          httpServer!.close((error) => (error ? reject(error) : resolve()));
        });
        httpServer = null;
      }
      await orchestrator.stop();
      removeSignals();
      logger.info("symphony_service_stopped");
    }
  };

  return service;
}

export function parseCli(argv: string[]): { workflowPath: string | null; port: number | null } {
  const args = [...argv];
  let workflowPath: string | null = null;
  let port: number | null = null;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--port") {
      const raw = args[i + 1];
      if (!raw) {
        throw new SymphonyError("invalid_cli", "--port requires an integer value");
      }
      port = Number.parseInt(raw, 10);
      if (!Number.isInteger(port) || port < 0) {
        throw new SymphonyError("invalid_cli", "--port must be a non-negative integer");
      }
      i += 1;
      continue;
    }
    if (!token.startsWith("-") && !workflowPath) {
      workflowPath = token;
      continue;
    }
    throw new SymphonyError("invalid_cli", `unknown argument '${token}'`);
  }

  return { workflowPath, port };
}

export function defaultLogger(): Logger {
  return createLogger("info");
}

