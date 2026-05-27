/**
 * `tale deploy --override-all` orchestration: invoke the convex-side
 * `reseedAllOrgsFromBuiltin` action via `docker exec` into the running
 * platform container. Mirrors the proven incantation pattern from
 * scripts/2026-03-28-migrate-convex-data.sh:120-131 (source env.sh,
 * ensure_instance_secret, compute admin key inline, run convex CLI).
 *
 * Destructive: factory-reseeds every org's non-secret config from the
 * builtin catalog. `*.secrets.json` files and `.history/` trails are
 * preserved server-side by `scaffoldNewOrganization({override:true})`.
 * Uploaded branding `images/` survive (branding is treated as a tree
 * with per-file overwrite). Everything else under each `<org>/<domain>/`
 * is overwritten with builtin content.
 */

import { confirm } from '../../utils/confirm';
import * as logger from '../../utils/logger';
import { exec } from '../docker/exec';
import { findPlatformContainer } from '../docker/find-platform-container';

export interface ReseedAllOrgsOptions {
  dryRun: boolean;
  assumeYes: boolean;
}

/**
 * The bash script piped into the platform container. Adopts the proven
 * env-sourcing pattern from scripts/2026-03-28-migrate-convex-data.sh so
 * `INSTANCE_SECRET` is guaranteed populated and the admin key derivation
 * matches the entrypoint's own runtime computation.
 *
 * Runtime workdir is `/app` (services/platform/Dockerfile sets
 * `WORKDIR /app`; flattens services/platform/{convex,lib,env.sh,…} into
 * `/app/`). No `cd /app/services/platform` — that path does not exist
 * at runtime.
 */
const RESEED_SCRIPT = `set -eo pipefail
source /app/env.sh
env_normalize_common
source /app/generate-admin-key.sh
ensure_instance_secret
ADMIN_KEY=$(generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET")
cd /app
HOME=/home/app timeout 1800 bunx convex run \\
  organizations/reseed_all_orgs:reseedAllOrgsFromBuiltin \\
  --url "\${CONVEX_URL:-http://convex:3210}" \\
  --admin-key "$ADMIN_KEY"
`;

const CONFIRM_MESSAGE =
  '--override-all will factory-reset every org from the builtin catalog. ' +
  '*.secrets.json files, .history/ trails, and uploaded branding/images/ are preserved; ' +
  'all other config (model lists, agents, workflows, skills, integrations, branding.json, retention.json) ' +
  'is overwritten. Proceed?';

export async function reseedAllOrgsFromBuiltin(
  options: ReseedAllOrgsOptions,
): Promise<void> {
  const { dryRun, assumeYes } = options;

  // Gate non-interactive callers behind --yes to avoid silent abort in CI.
  const isTty = Boolean(process.stdin.isTTY);
  if (!assumeYes && !isTty) {
    throw new Error(
      '--override-all requires --yes (-y) when stdin is not a TTY (e.g. CI).',
    );
  }
  if (!assumeYes && isTty) {
    const ok = await confirm(CONFIRM_MESSAGE);
    if (!ok) {
      logger.info('Aborted by user.');
      return;
    }
  }

  const container = await findPlatformContainer();

  if (dryRun) {
    logger.blank();
    logger.info('[DRY-RUN] Would run:');
    logger.info(`  docker exec ${container} bash -lc '<reseed script>'`);
    logger.info('Reseed script body (would be piped into bash):');
    for (const line of RESEED_SCRIPT.split('\n')) {
      logger.info(`  ${line}`);
    }
    return;
  }

  logger.blank();
  logger.step('Reseeding builtin catalog into all orgs...');

  // Pipe the script via stdin instead of embedding in argv — avoids shell
  // escaping pitfalls and keeps the script source readable.
  const result = await exec('docker', ['exec', '-i', container, 'bash', '-s'], {
    stdin: RESEED_SCRIPT,
  });

  if (!result.success) {
    if (result.stderr) {
      logger.error(result.stderr.trim());
    }
    throw new Error(
      `--override-all failed (docker exec into ${container} returned non-zero).`,
    );
  }

  // The action's return value is printed to stdout by `bunx convex run`.
  if (result.stdout) {
    const trimmed = result.stdout.trim();
    if (trimmed) {
      logger.info(trimmed);
    }
  }

  logger.success('Reseed complete.');
}
