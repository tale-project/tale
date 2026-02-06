import { Command } from "commander";
import { ensureConfig } from "../lib/config/ensure-config";
import { loadEnv } from "../utils/load-env";
import * as logger from "../utils/logger";
import { status } from "../lib/actions/status";

export function createStatusCommand(): Command {
  return new Command("status")
    .description("Show current deployment status")
    .action(async () => {
      try {
        const deployDir = await ensureConfig();
        const env = loadEnv(deployDir);
        await status({
          deployDir: env.DEPLOY_DIR,
        });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
