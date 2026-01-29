import { Command } from "commander";
import { ensureConfig } from "../lib/config/ensure-config";
import { getDefaultDeployDir } from "../lib/config/get-default-deploy-dir";
import { loadEnv } from "../utils/load-env";
import * as logger from "../utils/logger";
import { logs } from "./deploy/logs";

function getDirOptionDescription(): string {
  const defaultDir = getDefaultDeployDir();
  return defaultDir
    ? `Deployment directory (default: ${defaultDir})`
    : "Deployment directory";
}

export function createLogsCommand(): Command {
  return new Command("logs")
    .description("View logs from a service")
    .argument(
      "<service>",
      "Service name (platform, rag, crawler, search, db, graph-db, proxy)"
    )
    .option("-c, --color <color>", "Deployment color (blue or green)")
    .option("-f, --follow", "Follow log output", false)
    .option("--since <duration>", "Show logs since duration (e.g., 1h, 30m)")
    .option("-n, --tail <lines>", "Number of lines to show from end")
    .option("-d, --dir <path>", getDirOptionDescription())
    .action(async (service: string, options) => {
      try {
        const deployDir = await ensureConfig({ explicitDir: options.dir });
        const env = loadEnv(deployDir);

        if (
          options.color &&
          options.color !== "blue" &&
          options.color !== "green"
        ) {
          logger.error(
            `Invalid color: ${options.color}. Must be "blue" or "green".`
          );
          process.exit(1);
        }

        let tail: number | undefined;
        if (options.tail) {
          tail = parseInt(options.tail, 10);
          if (Number.isNaN(tail) || tail < 0) {
            logger.error(
              `Invalid --tail value: ${options.tail}. Must be a non-negative number.`
            );
            process.exit(1);
          }
        }

        await logs({
          service,
          color: options.color,
          follow: options.follow,
          since: options.since,
          tail,
          deployDir: env.DEPLOY_DIR,
          projectName: env.PROJECT_NAME,
        });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
