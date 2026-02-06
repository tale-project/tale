import { Command } from "commander";
import { ensureConfig } from "../lib/config/ensure-config";
import { loadEnv } from "../utils/load-env";
import * as logger from "../utils/logger";
import { cleanup } from "../lib/actions/cleanup";

export function createCleanupCommand(): Command {
  return new Command("cleanup")
    .description("Remove inactive (non-current) color containers")
    .action(async () => {
      try {
        const deployDir = await ensureConfig();
        const env = loadEnv(deployDir);
        await cleanup({ env });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
