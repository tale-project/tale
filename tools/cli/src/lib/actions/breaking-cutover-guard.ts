import { compareVersions } from '../../utils/compare-versions';
import { preconditionError } from '../../utils/fail';
import { getProjectId } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { getContainerVersion } from '../docker/get-container-version';
import { getCurrentColor } from '../state/get-current-color';
import { getPreviousVersion } from '../state/get-previous-version';

/**
 * The migration-baseline version. 0.4.0 reset the migration history to empty
 * (breaking cutover, fresh deploy only) — deploying a >= 0.4 CLI onto an
 * instance created by an older release cannot work: the old data has no
 * upgrade path and the new schema will not even push over it.
 *
 * The CLI is a standalone binary, so this constant lives here on its own —
 * it used to mirror the retired Convex migration framework's BASELINE_VERSION.
 * Bump it at the next breaking cutover.
 */
export const BREAKING_BASELINE = '0.4.0';

/** The guard's public option shape. @public */
export interface BreakingCutoverOptions {
  /** The workspace/deploy directory (state files live here). */
  deployDir: string;
  /** The version this CLI is about to deploy (`latest` on dev builds). */
  targetVersion: string;
  /** Expert override: proceed although pre-baseline data becomes unreadable. */
  acceptDataLoss?: boolean;
  /** Report instead of throwing (matches the preflight's dry-run behavior). */
  dryRun?: boolean;
}

function refusalMessage(runningVersion: string | null): string {
  const from =
    runningVersion === null
      ? 'an instance whose version cannot be determined'
      : `a v${runningVersion} instance`;
  return [
    `Deploying Tale >= ${BREAKING_BASELINE} onto ${from} is not supported.`,
    `0.4 is a breaking release with no upgrade path from 0.3.x: the migration history was reset, and pre-0.4 data cannot be read or migrated by 0.4 code.`,
    `Choose one:`,
    `  - Stay on 0.3.x for this instance: use a 0.3.x CLI; hotfixes ship from the release/0.3 branch.`,
    `  - Move to 0.4: create a FRESH deployment (new project directory via \`tale init\`, new volumes) and re-onboard users and content.`,
    `Docs: self-hosted → operate → upgrades → "0.3 → 0.4: breaking cutover".`,
    `Expert override: --accept-data-loss (CLI) / TALE_ACCEPT_DATA_LOSS=1 (container) — the existing data will NOT be readable afterwards.`,
  ].join('\n');
}

/**
 * Refuse a cross-baseline in-place deploy BEFORE anything is touched (no
 * image pull, no snapshot, no recreate). A container-side backstop with the
 * same semantics lives in docker-entrypoint.sh for non-CLI operators
 * (`[migrations][breaking-cutover]` marker); this guard exists to turn that
 * late, opaque failure into an immediate, explained refusal.
 *
 * Detection is the running (or last-deployed) platform version, not the
 * migration ledger: every pre-0.4 install replayed the migration chain on
 * first boot, so "instance version < baseline" and "data predates the
 * baseline" are the same fact — and the version label is readable even when
 * the backend is down.
 */
interface GuardDeps {
  getCurrentColor: typeof getCurrentColor;
  getContainerVersion: typeof getContainerVersion;
  getPreviousVersion: typeof getPreviousVersion;
  getProjectId: typeof getProjectId;
}

const defaultDeps: GuardDeps = {
  getCurrentColor,
  getContainerVersion,
  getPreviousVersion,
  getProjectId,
};

export async function checkBreakingCutover(
  options: BreakingCutoverOptions,
  deps: GuardDeps = defaultDeps,
): Promise<void> {
  const { deployDir, targetVersion, acceptDataLoss, dryRun } = options;

  // Dev builds deploy `latest`, which is always on the post-baseline line.
  const targetIsPostBaseline =
    targetVersion === 'latest' ||
    compareVersions(targetVersion, BREAKING_BASELINE) >= 0;
  if (!targetIsPostBaseline) return;

  const currentColor = await deps.getCurrentColor(deployDir);
  if (currentColor === null) return; // first deploy — nothing to cut over

  const runningVersion =
    (await deps.getContainerVersion(
      `${deps.getProjectId()}-platform-${currentColor}`,
    )) ?? (await deps.getPreviousVersion(deployDir));

  const preBaseline =
    runningVersion === null // deployment state exists but version unknowable
      ? true
      : compareVersions(runningVersion, BREAKING_BASELINE) < 0;
  if (!preBaseline) return;

  if (acceptDataLoss) {
    logger.warn(
      `--accept-data-loss: deploying v${targetVersion} over ${runningVersion === null ? 'an instance of unknown version' : `v${runningVersion}`} — pre-${BREAKING_BASELINE} data will NOT be readable.`,
    );
    return;
  }

  if (dryRun) {
    logger.warn(`Dry-run: this deploy would be refused —`);
    logger.warn(refusalMessage(runningVersion));
    return;
  }

  throw preconditionError(refusalMessage(runningVersion));
}
