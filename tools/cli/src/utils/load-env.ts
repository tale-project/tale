import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as logger from "./logger";

export const PROJECT_NAME = "tale";

export interface DeploymentEnv {
  GHCR_REGISTRY: string;
  HEALTH_CHECK_TIMEOUT: number;
  DRAIN_TIMEOUT: number;
  DEPLOY_DIR: string;
}

const DEFAULT_REGISTRY = "ghcr.io/tale-project/tale";
const DEFAULT_HEALTH_CHECK_TIMEOUT = 180;
const DEFAULT_DRAIN_TIMEOUT = 30;

function parseIntSafe(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseEnvFile(filePath: string): void {
  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    logger.warn(`Failed to parse env file: ${filePath}`);
  }
}

export function loadEnv(deployDir: string): DeploymentEnv {
  const envPath = join(deployDir, ".env");

  if (existsSync(envPath)) {
    parseEnvFile(envPath);
    logger.debug(`Loaded environment from ${envPath}`);
  }

  return {
    GHCR_REGISTRY: process.env.GHCR_REGISTRY ?? DEFAULT_REGISTRY,
    HEALTH_CHECK_TIMEOUT: parseIntSafe(process.env.HEALTH_CHECK_TIMEOUT, DEFAULT_HEALTH_CHECK_TIMEOUT),
    DRAIN_TIMEOUT: parseIntSafe(process.env.DRAIN_TIMEOUT, DEFAULT_DRAIN_TIMEOUT),
    DEPLOY_DIR: deployDir,
  };
}
