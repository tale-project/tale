import { existsSync } from "node:fs";
import * as logger from "./logger";

export interface DeploymentEnv {
  GHCR_REGISTRY: string;
  HEALTH_CHECK_TIMEOUT: number;
  DRAIN_TIMEOUT: number;
  PROJECT_NAME: string;
  DEPLOY_DIR: string;
}

const DEFAULT_REGISTRY = "ghcr.io/tale-project/tale";
const DEFAULT_HEALTH_CHECK_TIMEOUT = 180;
const DEFAULT_DRAIN_TIMEOUT = 30;
const DEFAULT_PROJECT_NAME = "tale";

export function loadEnv(deployDir: string): DeploymentEnv {
  const envPath = `${deployDir}/.env`;

  if (existsSync(envPath)) {
    logger.debug(`Environment file found at ${envPath}`);
  }

  return {
    GHCR_REGISTRY: process.env.GHCR_REGISTRY ?? DEFAULT_REGISTRY,
    HEALTH_CHECK_TIMEOUT: parseInt(
      process.env.HEALTH_CHECK_TIMEOUT ?? String(DEFAULT_HEALTH_CHECK_TIMEOUT),
      10
    ),
    DRAIN_TIMEOUT: parseInt(
      process.env.DRAIN_TIMEOUT ?? String(DEFAULT_DRAIN_TIMEOUT),
      10
    ),
    PROJECT_NAME: process.env.PROJECT_NAME ?? DEFAULT_PROJECT_NAME,
    DEPLOY_DIR: deployDir,
  };
}

export function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    logger.error(`Required environment variable ${name} is not set`);
    process.exit(1);
  }
  return value;
}
