import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import * as logger from "../../utils/logger";
import { ensureEnv } from "./ensure-env";
import { getConfig } from "./get-config";
import { getConfigFilePath } from "./get-config-file-path";
import { setConfig } from "./set-config";
import { CURRENT_CONFIG_VERSION, type GlobalConfig } from "./types";

const isTTY = process.stdin.isTTY && process.stdout.isTTY;

function getRecommendedDir(): string {
  return join(homedir(), ".tale", "deployments");
}

export interface EnsureConfigOptions {
  explicitDir?: string;
}

export async function ensureConfig(
  options: EnsureConfigOptions = {}
): Promise<string> {
  if (options.explicitDir) {
    if (!existsSync(options.explicitDir)) {
      await mkdir(options.explicitDir, { recursive: true });
      logger.info(`Created deployment directory: ${options.explicitDir}`);
    }
    return options.explicitDir;
  }

  const existingConfig = await getConfig();
  if (existingConfig) {
    return existingConfig.deployDir;
  }

  if (!isTTY) {
    logger.error("No deployment directory configured");
    logger.blank();
    logger.info("This appears to be your first time running Tale CLI.");
    logger.info(
      "Run the CLI interactively to set up your deployment directory,"
    );
    logger.info("or specify one explicitly with --dir <path>");
    logger.blank();
    logger.info("Example:");
    logger.info("  tale deploy v1.0.0 --dir ~/.tale/deployments");
    process.exit(1);
  }

  return await runFirstRunSetup();
}

async function runFirstRunSetup(): Promise<string> {
  const { select, input } = await import("@inquirer/prompts");

  logger.blank();
  logger.header("Welcome to Tale CLI");
  logger.info("This appears to be your first time running Tale CLI.");
  logger.info("Let's set up your deployment directory.");
  logger.blank();

  const recommendedDir = getRecommendedDir();
  const cwdDir = process.cwd();

  const choice = await select({
    message: "Where would you like to store deployment state?",
    choices: [
      {
        name: `${recommendedDir} (recommended)`,
        value: "recommended",
        description: "Centralized location in your home directory",
      },
      {
        name: `${cwdDir} (current directory)`,
        value: "cwd",
        description: "Use current working directory",
      },
      {
        name: "Custom path...",
        value: "custom",
        description: "Specify a custom directory",
      },
    ],
  });

  let deployDir: string;

  switch (choice) {
    case "recommended":
      deployDir = recommendedDir;
      break;
    case "cwd":
      deployDir = cwdDir;
      break;
    case "custom":
      deployDir = await input({
        message: "Enter deployment directory path:",
        default: recommendedDir,
        validate: (value) => {
          if (!value.trim()) {
            return "Path cannot be empty";
          }
          return true;
        },
      });
      if (deployDir.startsWith("~")) {
        deployDir = join(homedir(), deployDir.slice(1));
      }
      break;
    default:
      deployDir = recommendedDir;
  }

  if (!existsSync(deployDir)) {
    await mkdir(deployDir, { recursive: true });
    logger.info(`Created deployment directory: ${deployDir}`);
  }

  const config: GlobalConfig = {
    deployDir,
    configVersion: CURRENT_CONFIG_VERSION,
  };

  await setConfig(config);

  logger.blank();
  logger.success("Configuration saved!");
  logger.info(`Deployment directory: ${deployDir}`);
  logger.info(`Config file: ${getConfigFilePath()}`);

  const envSetupSuccess = await ensureEnv({ deployDir });
  if (!envSetupSuccess) {
    process.exit(1);
  }

  logger.blank();

  return deployDir;
}
