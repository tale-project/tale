/**
 * `tale deploy --override-all` orchestration: invoke the convex-side
 * `reseedAllOrgsFromBuiltin` action via `docker exec` into the running
 * platform container. Mirrors the proven incantation pattern from
 * scripts/2026-03-28-migrate-convex-data.sh:120-131 (source env.sh,
 * ensure_instance_secret, compute admin key inline, run convex CLI).
 *
 * Destructive: factory-reseeds every registered org's non-secret config
 * from the builtin catalog. `*.secrets.json` files and `.history/` trails
 * are preserved server-side by `scaffoldNewOrganization({override:true,
 * strict:true})`. Uploaded branding `images/` survive (branding is
 * treated as a tree with per-file overwrite). Everything else under each
 * `<org>/<domain>/` is overwritten with builtin content.
 *
 * Filesystem-only org subtrees (no Better Auth row) are NOT touched —
 * `--override-all` means "all registered orgs", not "every dir on disk".
 *
 * Failure semantics: the convex-side action throws on any per-org failure
 * (so `bunx convex run` exits non-zero), which surfaces as
 * `result.success === false` here and is converted to a CLI throw with
 * the per-org detail attached.
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
 * `--no-push` skips a redundant push step (we're calling an existing
 * deployed action). The trailing `grep -v` strips `bunx convex run`'s
 * decorative banner output ("Admin key", "📋", "✅ Admin", separators,
 * blank lines, etc.) so the final stdout is the action's JSON return
 * value alone — parseable in TypeScript.
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
  --admin-key "$ADMIN_KEY" \\
  --no-push 2>&1 \\
  | grep -v "^Admin key\\|^📋\\|^✅ Admin\\|^━\\|^🌐\\|^$\\|Steps:\\|Open\\|Enter\\|Paste"
`;

const CONFIRM_MESSAGE =
  '--override-all will factory-reset every registered org from the builtin catalog. ' +
  '*.secrets.json files, .history/ trails, and uploaded branding/images/ are preserved; ' +
  'all other config (model lists, agents, workflows, skills, integrations, branding.json, retention.json) ' +
  'is overwritten. Proceed?';

type ReseedResult = {
  total: number;
  succeeded: number;
  failed: number;
  results: Array<
    | { slug: string; status: 'ok' }
    | { slug: string; status: 'error'; error: string }
  >;
};

/**
 * Extract the last JSON object from a stream of mixed-output stdout.
 * `bunx convex run` prints `null` for void-returning actions or the
 * action's return value for value-returning ones. Either way, the JSON
 * payload is on its own line(s) at the very end.
 */
function parseTrailingJson(stdout: string): ReseedResult | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  // Walk backwards from the end looking for the start of a JSON value.
  // The action returns an object, so look for the matching `{`.
  const lastBrace = trimmed.lastIndexOf('{');
  if (lastBrace < 0) return null;

  try {
    const parsed = JSON.parse(trimmed.slice(lastBrace));
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.total === 'number' &&
      typeof parsed.succeeded === 'number' &&
      typeof parsed.failed === 'number' &&
      Array.isArray(parsed.results)
    ) {
      return parsed as ReseedResult;
    }
    return null;
  } catch {
    return null;
  }
}

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
    logger.info(`  docker exec -i ${container} bash -s <<'EOF'`);
    for (const line of RESEED_SCRIPT.split('\n')) {
      logger.info(`  ${line}`);
    }
    logger.info(`  EOF`);
    return;
  }

  logger.blank();
  logger.step('Reseeding builtin catalog into all registered orgs...');

  // Pipe the script via stdin instead of embedding in argv — avoids shell
  // escaping pitfalls and keeps the script source readable.
  const result = await exec('docker', ['exec', '-i', container, 'bash', '-s'], {
    stdin: RESEED_SCRIPT,
  });

  // The convex action throws on any per-org failure, which propagates to
  // `bunx convex run`'s exit code, which propagates to `docker exec`'s
  // exit code, which becomes `result.success === false` here.
  if (!result.success) {
    if (result.stdout) {
      logger.info(result.stdout.trim());
    }
    if (result.stderr) {
      logger.error(result.stderr.trim());
    }
    throw new Error(
      `--override-all failed: reseed action raised in ${container}. ` +
        `Per-org detail above; partial state on disk — re-run --override-all ` +
        `after addressing failures (the action is idempotent).`,
    );
  }

  // All orgs succeeded. Parse and summarize.
  const parsed = parseTrailingJson(result.stdout);
  if (parsed) {
    logger.info(
      `Reseeded ${parsed.succeeded}/${parsed.total} orgs from builtin catalog.`,
    );
  } else if (result.stdout) {
    // Couldn't parse — surface raw stdout so the operator isn't flying
    // blind. Should be rare given the grep strip above.
    logger.info(result.stdout.trim());
  }

  logger.success('Reseed complete.');
}
