#!/usr/bin/env bun
import { program } from "commander";
import { loadEnv } from "./utils/env";
import * as logger from "./utils/logger";
import { deployCommand } from "./commands/deploy";
import { rollbackCommand } from "./commands/rollback";
import { statusCommand } from "./commands/status";
import { cleanupCommand } from "./commands/cleanup";
import { resetCommand } from "./commands/reset";

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
  .option(
    "--update-stateful",
    "Also update stateful services (db, graph-db, proxy)",
    false
  )
  .option("-d, --dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .option("--host <hostname>", "Host alias for proxy", DEFAULT_HOST_ALIAS)
  .action(async (version: string, options) => {
    try {
      const env = loadEnv(options.dir);
      await deployCommand({
        version: version.replace(/^v/, ""),
        updateStateful: options.updateStateful,
        env,
        hostAlias: options.host,
      });
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("rollback")
  .description("Rollback to the previous version")
  .option("-d, --dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (options) => {
    try {
      const env = loadEnv(options.dir);
      await rollbackCommand({ env });
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
      await statusCommand({
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
      await cleanupCommand({ env });
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("reset")
  .description("Remove ALL blue-green containers (requires --force)")
  .option("--force", "Confirm reset", false)
  .option(
    "--include-stateful",
    "Also remove stateful services (db, graph-db, proxy)",
    false
  )
  .option("-d, --dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
  .action(async (options) => {
    try {
      const env = loadEnv(options.dir);
      await resetCommand({
        env,
        force: options.force,
        includeStateful: options.includeStateful,
      });
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse();
