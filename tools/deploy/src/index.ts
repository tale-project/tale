#!/usr/bin/env bun
import { program } from "commander";
import { loadEnv } from "./utils/load-env";
import * as logger from "./utils/logger";
import { cleanup } from "./commands/cleanup";
import { deploy } from "./commands/deploy";
import { logs } from "./commands/logs";
import { reset } from "./commands/reset";
import { rollback } from "./commands/rollback";
import { status } from "./commands/status";
import { type ServiceName, ALL_SERVICES, isValidService } from "./compose/types";

const VERSION = "1.0.0";
const DEFAULT_DEPLOY_DIR = process.cwd();
const DEFAULT_HOST_ALIAS = process.env.HOST ?? "tale.local";

program
  .name("tale-deploy")
  .description("Tale deployment CLI - secure blue-green deployments")
  .version(VERSION);

program
  .command("deploy")
  .description("Deploy a new version with zero-downtime blue-green strategy")
  .argument("<version>", "Version to deploy (e.g., v1.0.0 or 1.0.0)")
  .option("-a, --all", "Also update infrastructure (db, graph-db, proxy)", false)
  .option("-s, --services <list>", `Specific services to update (comma-separated: ${ALL_SERVICES.join(",")})`)
  .option("--dry-run", "Preview deployment without making changes", false)
  .option("-d, --dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("--host <hostname>", "Host alias for proxy", DEFAULT_HOST_ALIAS)
  .action(async (version: string, options) => {
    try {
      const env = loadEnv(options.dir);

      // Parse and validate services list
      let services: ServiceName[] | undefined;
      if (options.services) {
        const serviceList = options.services.split(",").map((s: string) => s.trim());
        const invalid = serviceList.filter((s: string) => !isValidService(s));
        if (invalid.length > 0) {
          logger.error(`Invalid service(s): ${invalid.join(", ")}`);
          logger.info(`Valid services: ${ALL_SERVICES.join(", ")}`);
          process.exit(1);
        }
        services = serviceList as ServiceName[];
      }

      await deploy({
        version: version.replace(/^v/, ""),
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

program
  .command("rollback")
  .description("Rollback to the previous version or a specific version")
  .option(
    "-v, --version <version>",
    "Specific version to rollback to (e.g., v1.0.0)"
  )
  .option("-d, --dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (options) => {
    try {
      const env = loadEnv(options.dir);
      await rollback({ env, version: options.version });
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show current deployment status")
  .option("-d, --dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (options) => {
    try {
      const env = loadEnv(options.dir);
      await status({
        deployDir: env.DEPLOY_DIR,
        projectName: env.PROJECT_NAME,
      });
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("cleanup")
  .description("Remove inactive (non-current) color containers")
  .option("-d, --dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (options) => {
    try {
      const env = loadEnv(options.dir);
      await cleanup({ env });
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("reset")
  .description("Remove ALL blue-green containers (requires --force)")
  .option("--force", "Confirm reset", false)
  .option("-a, --all", "Also remove infrastructure (db, graph-db, proxy)", false)
  .option("--dry-run", "Preview reset without making changes", false)
  .option("-d, --dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (options) => {
    try {
      const env = loadEnv(options.dir);
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

program
  .command("logs")
  .description("View logs from a service")
  .argument("<service>", "Service name (platform, rag, crawler, search, db, graph-db, proxy)")
  .option("-c, --color <color>", "Deployment color (blue or green)")
  .option("-f, --follow", "Follow log output", false)
  .option("--since <duration>", "Show logs since duration (e.g., 1h, 30m)")
  .option("-n, --tail <lines>", "Number of lines to show from end")
  .option("-d, --dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (service: string, options) => {
    try {
      const env = loadEnv(options.dir);
      await logs({
        service,
        color: options.color,
        follow: options.follow,
        since: options.since,
        tail: options.tail ? parseInt(options.tail, 10) : undefined,
        deployDir: env.DEPLOY_DIR,
        projectName: env.PROJECT_NAME,
      });
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse();
