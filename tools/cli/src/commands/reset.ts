import { Command } from "commander";
import { ensureConfig } from "../lib/config/ensure-config";
import { getDefaultDeployDir } from "../lib/config/get-default-deploy-dir";
import { loadEnv } from "../utils/load-env";
import * as logger from "../utils/logger";
import { reset } from "../lib/actions/reset";

function getDirOptionDescription(): string {
  const defaultDir = getDefaultDeployDir();
  return defaultDir
    ? `Deployment directory (default: ${defaultDir})`
    : "Deployment directory";
}

export function createResetCommand(): Command {
  return new Command("reset")
    .description("Remove ALL blue-green containers")
    .option("-f, --force", "Skip confirmation prompt", false)
    .option(
      "-a, --all",
      "Also remove infrastructure (db, graph-db, proxy)",
      false
    )
    .option("--dry-run", "Preview reset without making changes", false)
    .option("-d, --dir <path>", getDirOptionDescription())
    .action(async (options) => {
      try {
        const deployDir = await ensureConfig({ explicitDir: options.dir });
        const env = loadEnv(deployDir);
        await reset({
          env,
          force: options.force,
          includeStateful: options.all,
          dryRun: options.dryRun,
        });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
