/**
 * `tale deploy --override-all` orchestration: invoke the convex-side
 * `reseedAllOrgsFromBuiltin` action via `docker exec` into the running
 * platform container. Uses the same in-container incantation as the deploy
 * entrypoint: source env.sh, ensure_instance_secret, compute the admin key
 * inline, then run the convex CLI.
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

import * as logger from '../../utils/logger';
import { confirm } from '../../utils/prompt';
import {
  buildConvexRunScript,
  parseSentinelJson,
  redactAdminKey,
} from '../docker/convex-run';
import { exec } from '../docker/exec';
import { findPlatformContainer } from '../docker/find-platform-container';

interface ReseedAllOrgsOptions {
  dryRun: boolean;
  assumeYes: boolean;
}

/**
 * The bash script piped into the platform container is the shared
 * `buildConvexRunScript` incantation (docker/convex-run.ts): source env.sh so
 * `INSTANCE_SECRET` is guaranteed populated, derive the admin key exactly as
 * the deploy entrypoint does, run the deployed action with `--no-push`, and
 * frame the JSON return value between the stdout sentinels.
 *
 * Runtime workdir is `/app` (services/platform/Dockerfile sets `WORKDIR /app`;
 * flattens services/platform/{convex,lib,env.sh,…} into `/app/`). No
 * `cd /app/services/platform` — that path does not exist at runtime.
 */
const RESEED_TIMEOUT_S = 1800;
const RESEED_TIMEOUT_EXIT = 124;

const RESEED_SCRIPT = buildConvexRunScript(
  'organizations/reseed_all_orgs:reseedAllOrgsFromBuiltin',
  { timeoutS: RESEED_TIMEOUT_S },
);

const CONFIRM_MESSAGE =
  '--override-all will factory-reset every registered org from the builtin catalog. ' +
  '*.secrets.json files, .history/ trails, and uploaded branding/images/ are preserved; ' +
  'all other config (model lists, agents, workflows, skills, connectors, branding.json, governance policies + retention.json) ' +
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
 * Shape guard over the sentinel-framed return value — the action returns a
 * summary object; anything else (a bare `null` from an older backend, noise)
 * degrades to the raw-stdout fallback below.
 */
function isReseedResult(value: unknown): value is ReseedResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).total === 'number' &&
    typeof (value as Record<string, unknown>).succeeded === 'number' &&
    typeof (value as Record<string, unknown>).failed === 'number' &&
    Array.isArray((value as Record<string, unknown>).results)
  );
}

export async function reseedAllOrgsFromBuiltin(
  options: ReseedAllOrgsOptions,
): Promise<void> {
  const { dryRun, assumeYes } = options;

  // Dry-run gate sits BEFORE the destructive confirm prompt + the
  // platform-container lookup. Otherwise `tale deploy --override-all
  // --dry-run` would (a) still ask the operator to confirm a
  // destructive-shape operation that won't run, and (b) hard-throw
  // on hosts where no platform container is up yet — defeating the
  // point of a dry-run preview.
  if (dryRun) {
    logger.blank();
    logger.info(
      '[DRY-RUN] Would run reseed script against the platform container:',
    );
    for (const line of RESEED_SCRIPT.split('\n')) {
      logger.info(`  ${line}`);
    }
    return;
  }

  // Gate non-interactive callers behind --yes to avoid silent abort in CI.
  const isTty = Boolean(process.stdin.isTTY);
  if (!assumeYes && !isTty) {
    throw new Error(
      '--override-all requires --yes (-y) when stdin is not a TTY (e.g. CI).',
    );
  }
  if (!assumeYes && isTty) {
    const ok = await confirm({ message: CONFIRM_MESSAGE, default: false });
    if (!ok) {
      logger.info('Aborted by user.');
      return;
    }
  }

  const container = await findPlatformContainer();

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
      logger.info(redactAdminKey(result.stdout.trim()));
    }
    if (result.stderr) {
      logger.error(redactAdminKey(result.stderr.trim()));
    }

    // Special-case `timeout(1)`'s SIGTERM exit so the operator sees
    // "timed out" rather than a generic "raised". The action is
    // idempotent so re-running is always safe.
    if (result.exitCode === RESEED_TIMEOUT_EXIT) {
      throw new Error(
        `--override-all timed out after ${RESEED_TIMEOUT_S}s in ${container}. ` +
          `The reseed action may still be running on the convex side; ` +
          `wait a minute, then re-run (idempotent).`,
      );
    }

    // The convex-side action `console.log`s a human-readable failure
    // summary then `throw`s — `bunx convex run` does NOT emit the
    // action's return value on the throw path, so any attempt to parse
    // structured failure detail here is dead code. The stdout logged
    // above already surfaces the per-slug detail to the operator / CI.
    throw new Error(
      `--override-all failed: reseed action raised in ${container}. ` +
        `Per-org detail above; partial state on disk — re-run --override-all ` +
        `after addressing failures (the action is idempotent).`,
    );
  }

  // All orgs succeeded. Parse and summarize.
  const value = parseSentinelJson<unknown>(result.stdout);
  const parsed = isReseedResult(value) ? value : null;
  if (parsed) {
    logger.info(
      `Reseeded ${parsed.succeeded}/${parsed.total} orgs from builtin catalog.`,
    );
  } else if (result.stdout) {
    // Couldn't parse — surface raw stdout (redacted) so the operator
    // isn't flying blind. Should be rare given the sentinel framing.
    logger.info(redactAdminKey(result.stdout.trim()));
  }

  logger.success('Reseed complete.');
}
