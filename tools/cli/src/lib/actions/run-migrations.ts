/**
 * `tale migrate` orchestration: run the Convex provisioning runner
 * (`provisioning:provisionAll`) and the migration runner (`migrations:runAll`)
 * against the running platform container, on demand.
 *
 * These are the same two idempotent runners the container executes on every
 * deploy (services/platform/docker-entrypoint.sh), invoked as SEPARATE steps:
 * provisioning re-seeds the built-in default content (prompt library, task-ops
 * workflow pack) into every org, then migrations apply any pending non-
 * destructive data migrations. Safe to re-run — already-provisioned content
 * and already-applied migrations are skipped.
 *
 * Mirrors the proven env-sourcing + admin-key derivation incantation from
 * reseed-all-orgs.ts so `INSTANCE_SECRET` is populated and the admin key
 * matches the entrypoint's runtime computation.
 */

import * as logger from '../../utils/logger';
import { CONVEX_RUN_BANNER_GREP_V } from '../docker/convex-run';
import { exec } from '../docker/exec';
import { findPlatformContainer } from '../docker/find-platform-container';
import { redactAdminKey } from './reseed-all-orgs';

interface RunMigrationsOptions {
  dryRun: boolean;
}

const MIGRATE_TIMEOUT_S = 1800;
const MIGRATE_TIMEOUT_EXIT = 124;

/**
 * The bash pipeline piped into the platform container. Re-derives ADMIN_KEY
 * inline from env.sh's helpers — see reseed-all-orgs.ts for why the
 * generate-admin-key.sh banner is deliberately not sourced. The trailing
 * `grep -v` strips `bunx convex run`'s decorative banner so the captured
 * stdout is the action's output alone; `|| true` keeps a zero-match grep
 * from poisoning `pipefail` (the real signal is the run's exit code).
 */
const MIGRATE_SCRIPT = `set -eo pipefail
source /app/env.sh
env_normalize_common
ensure_instance_secret
ADMIN_KEY=$(generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET")
cd /app
STRIP='${CONVEX_RUN_BANNER_GREP_V}'
HOME=/home/app timeout ${MIGRATE_TIMEOUT_S} bunx convex run \\
  provisioning:provisionAll \\
  --url "\${CONVEX_URL:-http://convex:3210}" \\
  --admin-key "$ADMIN_KEY" \\
  --no-push 2>&1 \\
  | { grep -v "$STRIP" || true; }
HOME=/home/app timeout ${MIGRATE_TIMEOUT_S} bunx convex run \\
  migrations:runAll \\
  --url "\${CONVEX_URL:-http://convex:3210}" \\
  --admin-key "$ADMIN_KEY" \\
  --no-push 2>&1 \\
  | { grep -v "$STRIP" || true; }
`;

export async function runMigrations(
  options: RunMigrationsOptions,
): Promise<void> {
  const { dryRun } = options;

  if (dryRun) {
    logger.blank();
    logger.info(
      '[DRY-RUN] Would run the migration runner against the platform container:',
    );
    for (const line of MIGRATE_SCRIPT.split('\n')) {
      logger.info(`  ${line}`);
    }
    return;
  }

  const container = await findPlatformContainer();

  logger.blank();
  logger.step(
    'Running data migrations and re-provisioning built-in defaults...',
  );

  const result = await exec('docker', ['exec', '-i', container, 'bash', '-s'], {
    stdin: MIGRATE_SCRIPT,
  });

  if (!result.success) {
    if (result.stdout) {
      logger.info(redactAdminKey(result.stdout.trim()));
    }
    if (result.stderr) {
      logger.error(redactAdminKey(result.stderr.trim()));
    }

    if (result.exitCode === MIGRATE_TIMEOUT_EXIT) {
      throw new Error(
        `tale migrate timed out after ${MIGRATE_TIMEOUT_S}s in ${container}. ` +
          `The runner may still be executing on the convex side; wait a ` +
          `minute, then re-run (idempotent).`,
      );
    }

    throw new Error(
      `tale migrate failed: migrations:runAll raised in ${container}. ` +
        `Detail above; the runner is idempotent — re-run after addressing ` +
        `the failure.`,
    );
  }

  if (result.stdout?.trim()) {
    logger.info(redactAdminKey(result.stdout.trim()));
  }
  logger.success('Migrations complete.');
}
