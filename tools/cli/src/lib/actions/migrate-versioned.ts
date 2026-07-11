/**
 * `tale migrate {status,up,down}` orchestration: invoke the versioned
 * migration framework's entrypoint functions
 * (`migrations/framework/entrypoints:*`) via `docker exec` into the running
 * platform container, and parse their structured JSON results.
 *
 * The env-sourcing + admin-key derivation + sentinel-framed result transport
 * is the shared `buildConvexRunScript` (docker/convex-run.ts), parameterized
 * per entrypoint with a JSON args object.
 */

import * as logger from '../../utils/logger';
import {
  buildConvexRunScript,
  parseSentinelJson,
  redactAdminKey,
} from '../docker/convex-run';
import { exec } from '../docker/exec';
import { findPlatformContainer } from '../docker/find-platform-container';

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
  kind: 'db' | 'node' | 'component' | 'reference';
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
  /** Migrations whose last run FAILED — resumable via `tale migrate up`.
   *  Optional so the CLI keeps working against a pre-failed-field backend. */
  failed?: MigrationMeta[];
  failedErrors?: Record<string, string>;
}

export interface ApplyResult {
  dryRun: boolean;
  completed: string[];
  skipped: MigrationMeta[];
}

async function runEntrypoint<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const script = buildConvexRunScript(
    `migrations/framework/entrypoints:${fn}`,
    { args, timeoutS: TIMEOUT_S },
  );
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

  const parsed = parseSentinelJson<T>(result.stdout);
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
