/**
 * `tale migrate {status,up,down}` orchestration: invoke the versioned
 * migration framework's entrypoint functions
 * (`migrations/framework/entrypoints:*`) via `docker exec` into the running
 * platform container, and parse their structured JSON results.
 *
 * Mirrors the proven env-sourcing + admin-key derivation incantation from
 * run-migrations.ts / reseed-all-orgs.ts (so `INSTANCE_SECRET` is populated and
 * the admin key matches the entrypoint's runtime computation), parameterized
 * per entrypoint with a JSON args string.
 */

import * as logger from '../../utils/logger';
import {
  CONVEX_RUN_BANNER_GREP_V,
  parseConvexRunJson,
} from '../docker/convex-run';
import { exec } from '../docker/exec';
import { findPlatformContainer } from '../docker/find-platform-container';
import { redactAdminKey } from './reseed-all-orgs';

const TIMEOUT_S = 1800;
const TIMEOUT_EXIT = 124;

/** Migration metadata as returned by the backend entrypoints. */
export interface MigrationMeta {
  id: string;
  semver: string;
  numericId: number;
  slug: string;
  title: string;
  description: string;
  kind: 'db' | 'node' | 'reference';
  reversible: boolean;
  destructive: boolean;
  snapshot: 'none' | 'table-rows' | 'fs-tree';
}

interface MigrationStatus {
  frontier: string | null;
  applied: MigrationMeta[];
  pending: MigrationMeta[];
  pendingDestructive: string[];
  references: MigrationMeta[];
}

export interface ApplyResult {
  dryRun: boolean;
  completed: string[];
  skipped: MigrationMeta[];
}

/**
 * Args reach `bunx convex run <fn> '<json>'` as a single-quoted JSON literal.
 * Our args are version strings, id arrays, and booleans, so the serialized
 * value is restricted to this charset — a defense-in-depth guard against shell
 * injection should a future caller pass something exotic.
 */
const SAFE_ARGS_RE = /^[A-Za-z0-9_,[\]{}":. /\\-]*$/;

function buildScript(fn: string, args: Record<string, unknown>): string {
  const json = JSON.stringify(args);
  if (!SAFE_ARGS_RE.test(json)) {
    throw new Error(`Refusing to pass unsafe migration args: ${json}`);
  }
  return `set -eo pipefail
source /app/env.sh
env_normalize_common
ensure_instance_secret
ADMIN_KEY=$(generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET")
cd /app
HOME=/home/app timeout ${TIMEOUT_S} bunx convex run \\
  migrations/framework/entrypoints:${fn} '${json}' \\
  --url "\${CONVEX_URL:-http://convex:3210}" \\
  --admin-key "$ADMIN_KEY" \\
  --no-push 2>&1 \\
  | { grep -v "${CONVEX_RUN_BANNER_GREP_V}" || true; }
`;
}

async function runEntrypoint<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const script = buildScript(fn, args);
  const container = await findPlatformContainer();
  const result = await exec('docker', ['exec', '-i', container, 'bash', '-s'], {
    stdin: script,
  });

  if (!result.success) {
    if (result.stdout) logger.info(redactAdminKey(result.stdout.trim()));
    if (result.stderr) logger.error(redactAdminKey(result.stderr.trim()));
    if (result.exitCode === TIMEOUT_EXIT) {
      throw new Error(
        `tale migrate timed out after ${TIMEOUT_S}s in ${container}. The ` +
          `runner may still be executing; wait a minute then re-run ` +
          `(migrations are idempotent and resumable via the ledger).`,
      );
    }
    throw new Error(
      `tale migrate: ${fn} raised in ${container}. Detail above; the runner ` +
        `is resumable — re-run after addressing the failure.`,
    );
  }

  const parsed = parseConvexRunJson<T>(result.stdout);
  if (parsed === null) {
    throw new Error(
      `tale migrate: could not parse ${fn} output:\n` +
        redactAdminKey(result.stdout.trim()),
    );
  }
  return parsed;
}

// --- typed entrypoint wrappers --------------------------------------------

export function getStatus(): Promise<MigrationStatus> {
  return runEntrypoint<MigrationStatus>('status', {});
}

export function planUp(to?: string): Promise<MigrationMeta[]> {
  return runEntrypoint<MigrationMeta[]>('planUp', to ? { to } : {});
}

export function planDown(to: string): Promise<MigrationMeta[]> {
  return runEntrypoint<MigrationMeta[]>('planDown', { to });
}

export function applyUp(opts: {
  to?: string;
  only?: string[];
  allowDestructive?: boolean;
  dryRun?: boolean;
}): Promise<ApplyResult> {
  const args: Record<string, unknown> = {};
  if (opts.to) args.to = opts.to;
  if (opts.only) args.only = opts.only;
  if (opts.allowDestructive) args.allowDestructive = true;
  if (opts.dryRun) args.dryRun = true;
  return runEntrypoint<ApplyResult>('applyUp', args);
}

export function applyDown(opts: {
  to: string;
  only?: string[];
  dryRun?: boolean;
}): Promise<ApplyResult> {
  const args: Record<string, unknown> = { to: opts.to };
  if (opts.only) args.only = opts.only;
  if (opts.dryRun) args.dryRun = true;
  return runEntrypoint<ApplyResult>('applyDown', args);
}
