import { Command } from "commander";
import { ensureConfig } from "../lib/config/ensure-config";
import { getDefaultDeployDir } from "../lib/config/get-default-deploy-dir";
import { loadEnv } from "../utils/load-env";
import * as logger from "../utils/logger";
import { cleanup } from "../lib/actions/cleanup";

function getDirOptionDescription(): string {
  const defaultDir = getDefaultDeployDir();
  return defaultDir
    ? `Deployment directory (default: ${defaultDir})`
    : "Deployment directory";
}

export function createCleanupCommand(): Command {
  return new Command("cleanup")
    .description("Remove inactive (non-current) color containers")
    .option("-d, --dir <path>", getDirOptionDescription())
    .action(async (options) => {
      try {
        const deployDir = await ensureConfig({ explicitDir: options.dir });
        const env = loadEnv(deployDir);
        await cleanup({ env });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
