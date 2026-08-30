/**
 * `tale deploy --override-all` orchestration: POST the backend's
 * `/api/control/reseed` door (docker/control-call.ts) and report the per-org
 * verdict it returns.
 *
 * Destructive: factory-reseeds every registered org's non-secret config from
 * the builtin catalog. `*.secrets.json` files and `.history/` trails are
 * preserved server-side by the scaffolder's `override:true, strict:true`
 * pass. Uploaded branding `images/` survive (branding is treated as a tree
 * with per-file overwrite). Everything else under each `<org>/<domain>/` is
 * overwritten with builtin content.
 *
 * Filesystem-only org subtrees (no organization row) are NOT touched —
 * `--override-all` means "all registered orgs", not "every dir on disk".
 *
 * Failure semantics: the door sweeps every org and reports each outcome, so a
 * partial run names the orgs that failed instead of stopping at the first.
 * Any failure is a CLI throw with that detail attached; the reseed is
 * idempotent, so re-running after a fix is always safe.
 */

import * as logger from '../../utils/logger';
import { confirm } from '../../utils/prompt';
import {
  backendApiContainer,
  controlCall,
  isBackendTierRunning,
} from '../docker/control-call';

interface ReseedAllOrgsOptions {
  dryRun: boolean;
  assumeYes: boolean;
}

const RESEED_TIMEOUT_S = 1800;
const RESEED_TIMEOUT_EXIT = 124;

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
 * Shape guard over the door's JSON. Anything else (an older backend, noise)
 * degrades to the raw-stdout fallback rather than a confident wrong summary.
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

/** The failed orgs, one `slug: error` line each. */
function failureLines(result: ReseedResult): string[] {
  return result.results
    .filter(
      (r): r is { slug: string; status: 'error'; error: string } =>
        r.status === 'error',
    )
    .map((r) => `  ${r.slug}: ${r.error}`);
}

export async function reseedAllOrgsFromBuiltin(
  options: ReseedAllOrgsOptions,
): Promise<void> {
  const { dryRun, assumeYes } = options;
  const container = backendApiContainer();

  // Dry-run gate sits BEFORE the destructive confirm prompt + the container
  // check. Otherwise `tale deploy --override-all --dry-run` would (a) still
  // ask the operator to confirm a destructive-shape operation that won't run,
  // and (b) hard-throw on hosts where no backend is up yet — defeating the
  // point of a dry-run preview.
  if (dryRun) {
    logger.blank();
    logger.info(
      `[DRY-RUN] Would factory-reseed every registered org via POST /api/control/reseed in ${container}.`,
    );
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

  if (!(await isBackendTierRunning())) {
    throw new Error(
      `--override-all needs the backend tier: no ${container} container is running. ` +
        'Start the deployment (`tale start`), then re-run.',
    );
  }

  logger.blank();
  logger.step('Reseeding builtin catalog into all registered orgs...');

  const result = await controlCall('POST', '/api/control/reseed', {
    container,
    timeoutS: RESEED_TIMEOUT_S,
  });

  if (!result.success) {
    if (result.stderr) logger.error(result.stderr.trim());
    // Special-case `timeout(1)`'s SIGTERM exit so the operator sees "timed
    // out" rather than a generic refusal. The reseed is idempotent, so
    // re-running is always safe.
    if (result.exitCode === RESEED_TIMEOUT_EXIT) {
      throw new Error(
        `--override-all timed out after ${RESEED_TIMEOUT_S}s in ${container}. ` +
          'The reseed may still be running in the backend; wait a minute, ' +
          'then re-run (idempotent).',
      );
    }
    throw new Error(
      `--override-all failed: the control door refused in ${container}. ` +
        `${result.stderr.trim().slice(0, 200)} — the reseed is idempotent, so ` +
        're-run after addressing the failure.',
    );
  }

  let parsed: ReseedResult | null = null;
  try {
    const value: unknown = JSON.parse(result.stdout);
    parsed = isReseedResult(value) ? value : null;
  } catch (err) {
    logger.debug(`reseed response parse failed: ${String(err)}`);
  }

  if (!parsed) {
    // Couldn't parse — surface raw stdout so the operator isn't flying blind.
    if (result.stdout) logger.info(result.stdout.trim());
    logger.success('Reseed complete.');
    return;
  }

  if (parsed.failed > 0) {
    for (const line of failureLines(parsed)) logger.error(line);
    throw new Error(
      `--override-all failed for ${parsed.failed}/${parsed.total} org(s). ` +
        'Per-org detail above; partial state on disk — re-run --override-all ' +
        'after addressing the failures (the reseed is idempotent).',
    );
  }

  logger.info(
    `Reseeded ${parsed.succeeded}/${parsed.total} orgs from builtin catalog.`,
  );
  logger.success('Reseed complete.');
}
