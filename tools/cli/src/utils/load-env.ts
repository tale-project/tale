import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as logger from './logger';

export { getProjectId } from '../lib/project/project-context';

export interface DeploymentEnv {
  GHCR_REGISTRY: string;
  SITE_URL: string;
  HEALTH_CHECK_TIMEOUT: number;
  DRAIN_TIMEOUT: number;
  DEPLOY_DIR: string;
  /**
   * Where the proxy sends the app's API lanes (`backend-api:3005`). Kept as
   * an override so an operator can point the proxy at a differently-named or
   * externally-hosted backend without editing the generated Caddyfile.
   */
  BACKEND_UPSTREAM: string;
}

const DEFAULT_REGISTRY = 'ghcr.io/tale-project/tale';
const DEFAULT_HEALTH_CHECK_TIMEOUT = 300;
const DEFAULT_DRAIN_TIMEOUT = 30;
const DEFAULT_BACKUP_KEEP_COUNT = 5;
const DEFAULT_BACKUP_KEEP_DAYS = 14;

function parseIntSafe(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseEnvFile(filePath: string): void {
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed
        .slice(eqIndex + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    logger.warn(`Failed to parse env file: ${filePath}`);
  }
}

/**
 * Snapshot-rotation retention, overridable via `BACKUP_KEEP_COUNT` /
 * `BACKUP_KEEP_DAYS`. Read from process.env at call time (loadEnv folds the
 * project `.env` into process.env) so the backup module works from code
 * paths that don't carry a DeploymentEnv (e.g. the legacy-layout preflight).
 */
export function getBackupRetention(): { keepCount: number; keepDays: number } {
  return {
    keepCount: parseIntSafe(
      process.env.BACKUP_KEEP_COUNT,
      DEFAULT_BACKUP_KEEP_COUNT,
    ),
    keepDays: parseIntSafe(
      process.env.BACKUP_KEEP_DAYS,
      DEFAULT_BACKUP_KEEP_DAYS,
    ),
  };
}

export function loadEnv(deployDir: string): DeploymentEnv {
  const envPath = join(deployDir, '.env');

  if (existsSync(envPath)) {
    parseEnvFile(envPath);
    logger.debug(`Loaded environment from ${envPath}`);
  }

  return {
    GHCR_REGISTRY: process.env.GHCR_REGISTRY ?? DEFAULT_REGISTRY,
    SITE_URL: process.env.SITE_URL ?? 'https://localhost',
    HEALTH_CHECK_TIMEOUT: parseIntSafe(
      process.env.HEALTH_CHECK_TIMEOUT,
      DEFAULT_HEALTH_CHECK_TIMEOUT,
    ),
    DRAIN_TIMEOUT: parseIntSafe(
      process.env.DRAIN_TIMEOUT,
      DEFAULT_DRAIN_TIMEOUT,
    ),
    DEPLOY_DIR: deployDir,
    BACKEND_UPSTREAM: process.env.BACKEND_UPSTREAM ?? '',
  };
}
