import { Command } from "commander";
import { ensureConfig } from "../lib/config/ensure-config";
import { ensureEnv } from "../lib/config/ensure-env";
import { getDefaultDeployDir } from "../lib/config/get-default-deploy-dir";
import { loadEnv } from "../utils/load-env";
import * as logger from "../utils/logger";
import { rollback } from "../lib/actions/rollback";

function getDirOptionDescription(): string {
  const defaultDir = getDefaultDeployDir();
  return defaultDir
    ? `Deployment directory (default: ${defaultDir})`
    : "Deployment directory";
}

export function createRollbackCommand(): Command {
  return new Command("rollback")
    .description("Rollback to the previous version or a specific version")
    .option(
      "-v, --version <version>",
      "Specific version to rollback to (e.g., v1.0.0)"
    )
    .option("-d, --dir <path>", getDirOptionDescription())
    .action(async (options) => {
      try {
        const deployDir = await ensureConfig({ explicitDir: options.dir });
        const envSetupSuccess = await ensureEnv({ deployDir });
        if (!envSetupSuccess) {
          process.exit(1);
        }
        const env = loadEnv(deployDir);
        await rollback({ env, version: options.version });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
