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
 * Transport: same env-sourcing + admin-key incantation as
 * docker/convex-run.ts's `buildConvexRunScript`, inlined here because this
 * script chains TWO runs. Streams are never merged — `bunx convex run` prints
 * return values to stdout and banners + function `console.*` logs to stderr;
 * the informative migration log lines are relayed from stderr after a
 * display-only banner filter.
 */

import * as logger from '../../utils/logger';
import { redactAdminKey, stripConvexBannerLines } from '../docker/convex-run';
import { docker } from '../docker/docker';
import { exec } from '../docker/exec';
import { findPlatformContainer } from '../docker/find-platform-container';
import { backendApiContainer, isBackendTierRunning } from './drain-backend';

interface RunMigrationsOptions {
  dryRun: boolean;
}

const MIGRATE_TIMEOUT_S = 1800;
const MIGRATE_TIMEOUT_EXIT = 124;

/**
 * The bash pipeline piped into the platform container. Re-derives ADMIN_KEY
 * inline from env.sh's helpers — see docker/convex-run.ts for why the
 * generate-admin-key.sh banner is deliberately not sourced. Both runners are
 * void-returning, so stdout is discarded; their `console.*` output arrives on
 * stderr and is relayed by the caller.
 */
// The first line is a bash comment that acts as the bundle sentinel for
// scripts/check-bundle.ts. It exists ONLY inside this template literal —
// never repeat it in a comment or another string, or the post-build
// binary check can pass while the script itself regressed to a runtime
// fs read (which `bun --compile` does not bundle).
const MIGRATE_SCRIPT = `# tale-bundle-sentinel:migrate-script-v2
set -eo pipefail
source /app/env.sh
env_normalize_common
ensure_instance_secret
ADMIN_KEY=$(generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET")
cd /app
HOME=/home/app timeout ${MIGRATE_TIMEOUT_S} bunx convex run \\
  provisioning:provisionAll \\
  --url "\${CONVEX_URL:-http://convex:3210}" \\
  --admin-key "$ADMIN_KEY" \\
  --no-push >/dev/null
HOME=/home/app timeout ${MIGRATE_TIMEOUT_S} bunx convex run \\
  migrations:runAll \\
  --url "\${CONVEX_URL:-http://convex:3210}" \\
  --admin-key "$ADMIN_KEY" \\
  --no-push >/dev/null
`;

export async function runMigrations(
  options: RunMigrationsOptions,
): Promise<void> {
  const { dryRun } = options;

  // A stack that has cut over to Postgres has no Convex runners to call:
  // schema migrations apply themselves at backend boot (advisory-locked), so
  // `tale migrate` there means "re-seed every org's provisioned content" —
  // the control door's idempotent provision step.
  if (await isBackendTierRunning()) {
    await runBackendProvisioning({ dryRun });
    return;
  }

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

  // The runners' console.* output (applied migrations, destructive-pending
  // warnings) arrives on stderr; relay it minus the CLI's decorative banners.
  const logs = stripConvexBannerLines(result.stderr).trim();
  if (logs) {
    logger.info(redactAdminKey(logs));
  }
  logger.success('Migrations complete.');
}

/**
 * The Postgres lane's `tale migrate`: POST the control door's provision
 * step from inside the api container (the token never leaves it), then
 * report how many organizations were queued. Schema migrations are
 * deliberately absent — the backend runs them at boot.
 */
async function runBackendProvisioning(options: {
  dryRun: boolean;
}): Promise<void> {
  const container = backendApiContainer();
  if (options.dryRun) {
    logger.blank();
    logger.info(
      `[DRY-RUN] Would re-provision every organization via POST /api/control/provision in ${container} ` +
        '(schema migrations run at backend boot).',
    );
    return;
  }

  logger.blank();
  logger.step('Re-provisioning built-in defaults for every organization...');
  const res = await docker(
    'exec',
    container,
    'sh',
    '-c',
    'curl -fsS -X POST -H "Authorization: Bearer $TALE_CONTROL_TOKEN" http://localhost:3005/api/control/provision',
  );
  if (!res.success) {
    throw new Error(
      `tale migrate failed: the control door refused in ${container}. ` +
        `${res.stderr.trim().slice(0, 200)} — the step is idempotent, so ` +
        `re-run after addressing the failure.`,
    );
  }
  let organizations: number | null = null;
  try {
    const parsed: unknown = JSON.parse(res.stdout);
    if (typeof parsed === 'object' && parsed !== null) {
      const value = (parsed as Record<string, unknown>).organizations;
      if (typeof value === 'number') organizations = value;
    }
  } catch (err) {
    logger.debug(`provision response parse failed: ${String(err)}`);
  }
  logger.success(
    organizations === null
      ? 'Provisioning queued.'
      : `Provisioning queued for ${organizations} organization(s).`,
  );
}
