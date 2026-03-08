import { createSymphonyService, parseCli } from "./service.js";
import { asSymphonyError } from "./errors.js";
import { resolveWorkflowPath } from "./workflow.js";

async function main(): Promise<void> {
  try {
    const { workflowPath, port } = parseCli(process.argv.slice(2));
    const resolvedWorkflow = resolveWorkflowPath(workflowPath ?? undefined);
    const service = await createSymphonyService({
      workflowPath: resolvedWorkflow,
      portOverride: port
    });
    await service.start();
  } catch (error) {
    const se = asSymphonyError(error, "startup_failed");
    console.error(`${se.code}: ${se.message}`);
    process.exit(1);
  }
}

void main();

