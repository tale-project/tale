import { Command } from "commander";
import { ensureConfig } from "../lib/config/ensure-config";
import { getDefaultDeployDir } from "../lib/config/get-default-deploy-dir";
import { loadEnv } from "../utils/load-env";
import * as logger from "../utils/logger";
import { status } from "../lib/actions/status";

function getDirOptionDescription(): string {
  const defaultDir = getDefaultDeployDir();
  return defaultDir
    ? `Deployment directory (default: ${defaultDir})`
    : "Deployment directory";
}

export function createStatusCommand(): Command {
  return new Command("status")
    .description("Show current deployment status")
    .option("-d, --dir <path>", getDirOptionDescription())
    .action(async (options) => {
      try {
        const deployDir = await ensureConfig({ explicitDir: options.dir });
        const env = loadEnv(deployDir);
        await status({
          deployDir: env.DEPLOY_DIR,
          projectName: env.PROJECT_NAME,
        });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
