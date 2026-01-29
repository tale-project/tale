import { Command } from "commander";
import {
  type ServiceName,
  ALL_SERVICES,
  isValidService,
} from "../../lib/compose/types";
import { ensureConfig } from "../../lib/config/ensure-config";
import { ensureEnv } from "../../lib/config/ensure-env";
import { getDefaultDeployDir } from "../../lib/config/get-default-deploy-dir";
import { selectVersion } from "../../lib/registry/select-version";
import { loadEnv } from "../../utils/load-env";
import * as logger from "../../utils/logger";
import { cleanup } from "./cleanup";
import { deploy } from "./deploy";
import { logs } from "./logs";
import { reset } from "./reset";
import { rollback } from "./rollback";
import { status } from "./status";

const DEFAULT_HOST_ALIAS = process.env.HOST ?? "tale.local";

function getDirOptionDescription(): string {
  const defaultDir = getDefaultDeployDir();
  return defaultDir
    ? `Deployment directory (default: ${defaultDir})`
    : "Deployment directory";
}

export function createDeployCommand(): Command {
  const deployCmd = new Command("deploy")
    .description("Deployment management commands")
    .argument("[version]", "Version to deploy (e.g., v1.0.0 or 1.0.0)")
    .option(
      "-a, --all",
      "Also update infrastructure (db, graph-db, proxy)",
      false
    )
    .option(
      "-s, --services <list>",
      `Specific services to update (comma-separated: ${ALL_SERVICES.join(",")})`
    )
    .option("--dry-run", "Preview deployment without making changes", false)
    .option("-d, --dir <path>", getDirOptionDescription())
    .option("--host <hostname>", "Host alias for proxy", DEFAULT_HOST_ALIAS)
    .action(async (versionArg: string | undefined, options) => {
      try {
        const deployDir = await ensureConfig({ explicitDir: options.dir });
        const envSetupSuccess = await ensureEnv({ deployDir });
        if (!envSetupSuccess) {
          process.exit(1);
        }
        const env = loadEnv(deployDir);

        let version = versionArg?.replace(/^v/, "");
        if (!version) {
          const selected = await selectVersion(env.GHCR_REGISTRY);
          if (!selected) {
            process.exit(1);
          }
          version = selected;
        }

        let services: ServiceName[] | undefined;
        if (options.services) {
          const serviceList = options.services
            .split(",")
            .map((s: string) => s.trim());
          const invalid = serviceList.filter(
            (s: string) => !isValidService(s)
          );
          if (invalid.length > 0) {
            logger.error(`Invalid service(s): ${invalid.join(", ")}`);
            logger.info(`Valid services: ${ALL_SERVICES.join(", ")}`);
            process.exit(1);
          }
          services = serviceList as ServiceName[];
        }

        await deploy({
          version,
          updateStateful: options.all,
          env,
          hostAlias: options.host,
          dryRun: options.dryRun,
          services,
        });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  deployCmd
    .command("rollback")
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

  deployCmd
    .command("status")
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

  deployCmd
    .command("cleanup")
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

  deployCmd
    .command("reset")
    .description("Remove ALL blue-green containers (requires --force)")
    .option("--force", "Confirm reset", false)
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

  deployCmd
    .command("logs")
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

  return deployCmd;
}
