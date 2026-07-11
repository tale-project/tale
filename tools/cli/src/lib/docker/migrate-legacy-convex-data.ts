import * as logger from '../../utils/logger';
import { getOutputMode } from '../../utils/output-mode';
import { confirm, isInteractive } from '../../utils/prompt';
import { readProject } from '../project/read-project';
import {
  findOrphanedConvexDataVolumes,
  type OrphanedDataVolume,
} from './detect-legacy-convex-data';
import { docker } from './docker';
import type { ExecResult } from './exec';

/**
 * One-shot detect+copy pass for the pre-0.3.2 volume layout (P1-8, #1755).
 *
 * Detection lives in detect-legacy-convex-data.ts; this module is the remedy:
 * offer to move the orphaned `platform-data` volume's contents into the
 * `convex-data` volume the current compose files mount, before the operator
 * deploys onto a fresh empty volume. Docker has no native volume rename, so
 * the "rename" is a copy through a throwaway helper container — the same
 * steps the manual runbook in docs/self-hosted/operate/upgrades.md documents.
 *
 * Safety rules:
 *  - never overwrite: an existing destination volume aborts the copy;
 *  - never copy a live volume: a running container mounting the source aborts;
 *  - never lose the source: it is mounted read-only and always preserved;
 *  - stay idempotent: a failed copy removes the just-created destination so
 *    the orphan stays detectable and the pass can simply run again.
 */

type DockerFn = (...args: string[]) => Promise<ExecResult>;

/** Same helper image as the manual runbook's `docker run` commands. */
const HELPER_IMAGE = 'alpine';

/** Where the manual steps live — printed on every declined/failed path. */
const RUNBOOK_POINTER =
  'see "Upgrading from 0.3.1 or earlier" in docs/self-hosted/operate/upgrades.md';

/** Count what `cp -a` copies (regular files + symlinks) to verify the copy. */
async function countVolumeFiles(
  name: string,
  dockerFn: DockerFn,
): Promise<number> {
  const r = await dockerFn(
    'run',
    '--rm',
    '-v',
    `${name}:/vol:ro`,
    '--entrypoint',
    'sh',
    HELPER_IMAGE,
    '-c',
    String.raw`find /vol \( -type f -o -type l \) | wc -l`,
  );
  const count = Number.parseInt(r.stdout.trim(), 10);
  if (!r.success || !Number.isFinite(count)) {
    throw new Error(
      `could not count files in ${name}: ${(r.stderr || r.stdout).trim()}`,
    );
  }
  return count;
}

/**
 * Copy one orphaned legacy volume into its destination and verify the copy by
 * comparing file counts. Throws on any failure; a failure after the
 * destination was created removes it again so the constellation stays
 * detectable (a partial `convex-data` volume would both silence the warning
 * and deploy broken).
 */
export async function copyLegacyConvexDataVolume(
  pair: OrphanedDataVolume,
  projectId: string,
  dockerFn: DockerFn = docker,
): Promise<void> {
  // Never overwrite: re-check at execution time — the detection pass ran
  // earlier and something (a parallel deploy, a manual step) may have
  // created the destination in between.
  if ((await dockerFn('volume', 'inspect', pair.target)).success) {
    throw new Error(
      `refusing to copy ${pair.legacy}: destination volume ${pair.target} ` +
        `already exists. If an earlier deploy created it empty, remove it ` +
        `first (docker volume rm ${pair.target}); ${RUNBOOK_POINTER}.`,
    );
  }

  // Never copy a live volume: a running container holding it means writes
  // mid-copy and a silently inconsistent destination.
  const inUse = await dockerFn(
    'ps',
    '--filter',
    `volume=${pair.legacy}`,
    '--format',
    '{{.Names}}',
  );
  if (!inUse.success) {
    throw new Error(
      `could not check whether ${pair.legacy} is in use: ${inUse.stderr.trim()}`,
    );
  }
  const users = inUse.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (users.length > 0) {
    const composeProject = pair.legacy.replace(/_platform-data$/, '');
    throw new Error(
      `${pair.legacy} is mounted by running container(s): ${users.join(', ')}. ` +
        `Stop the stack first (docker compose -p ${composeProject} down), ` +
        `then re-run \`tale update\`.`,
    );
  }

  // Label the volume like ensure-volumes does, so `tale reset` can prune it.
  const created = await dockerFn(
    'volume',
    'create',
    '--label',
    `project=${projectId}`,
    pair.target,
  );
  if (!created.success) {
    throw new Error(
      `failed to create destination volume ${pair.target}: ${created.stderr.trim()}`,
    );
  }

  try {
    const copy = await dockerFn(
      'run',
      '--rm',
      '-v',
      `${pair.legacy}:/from:ro`,
      '-v',
      `${pair.target}:/to`,
      '--entrypoint',
      'sh',
      HELPER_IMAGE,
      '-ec',
      'cp -a /from/. /to/',
    );
    if (!copy.success) {
      throw new Error(
        `copy ${pair.legacy} → ${pair.target} failed: ${copy.stderr.trim()}`,
      );
    }
    const srcCount = await countVolumeFiles(pair.legacy, dockerFn);
    const dstCount = await countVolumeFiles(pair.target, dockerFn);
    if (srcCount !== dstCount) {
      throw new Error(
        `file count mismatch after copying ${pair.legacy} → ${pair.target} ` +
          `(source=${srcCount}, destination=${dstCount}); refusing to keep ` +
          `the incomplete copy`,
      );
    }
    logger.success(`  ${pair.legacy} → ${pair.target} (${srcCount} files)`);
  } catch (err) {
    // Roll the half-written destination back so the orphan stays detectable
    // and the pass is safe to re-run. The legacy source is untouched.
    const removed = await dockerFn('volume', 'rm', pair.target);
    if (!removed.success) {
      logger.error(
        `could not remove the partially-copied volume ${pair.target}: ` +
          `${removed.stderr.trim()}. Remove it manually ` +
          `(docker volume rm ${pair.target}) before deploying — a partial ` +
          `copy would bring the instance up inconsistent.`,
      );
    }
    throw err;
  }
}

/** What the offer pass ended up doing — the caller only logs, tests assert. */
export type LegacyMigrationOutcome =
  | 'none'
  | 'dry-run'
  | 'declined'
  | 'copied'
  | 'failed';

/**
 * Injectable seams so the offer flow (warn → prompt → copy) is unit-testable
 * without a real Docker daemon or a TTY. Production passes the defaults.
 */
export interface OfferLegacyMigrationDeps {
  readProjectId: (projectDir: string) => Promise<string | undefined>;
  findOrphaned: (projectId: string) => Promise<OrphanedDataVolume[]>;
  copyVolume: (pair: OrphanedDataVolume, projectId: string) => Promise<void>;
  confirmCopy: (message: string) => Promise<boolean>;
  /** Whether a prompt can be answered (a TTY is attached, or `--yes`). */
  canPrompt: () => boolean;
}

const defaultDeps: OfferLegacyMigrationDeps = {
  readProjectId: async (projectDir) => {
    const projectId = (await readProject(projectDir)).id;
    return typeof projectId === 'string' && projectId.trim() !== ''
      ? projectId
      : undefined;
  },
  findOrphaned: (projectId) => findOrphanedConvexDataVolumes(projectId),
  copyVolume: (pair, projectId) => copyLegacyConvexDataVolume(pair, projectId),
  confirmCopy: (message) => confirm({ message, default: true }),
  canPrompt: () => isInteractive() || getOutputMode().assumeYes,
};

/**
 * The `tale update` pass for P1-8 (#1755): detect the pre-0.3.2 layout, warn
 * LOUDLY (always — even when the copy is declined or impossible), and offer
 * to run the copy right here. Detection failures (Docker unreachable,
 * tale.json unreadable, no project id yet) are debug lines — the pass is
 * best-effort and must never block an update. A failed copy is reported as
 * an error but does not abort the update either: the update itself does not
 * deploy, and the runbook remains the fallback.
 */
export async function offerLegacyConvexDataMigration(
  projectDir: string,
  opts: { dryRun?: boolean } = {},
  deps: OfferLegacyMigrationDeps = defaultDeps,
): Promise<LegacyMigrationOutcome> {
  let projectId: string | undefined;
  let orphaned: OrphanedDataVolume[] = [];
  try {
    projectId = await deps.readProjectId(projectDir);
    // A legacy project without an id gets one on the next deploy — nothing
    // to check yet.
    if (projectId === undefined) return 'none';
    orphaned = await deps.findOrphaned(projectId);
  } catch (err) {
    // Docker unavailable, tale.json unreadable, … — detection is
    // best-effort and must never block an update.
    logger.debug(`legacy volume detection skipped: ${String(err)}`);
    return 'none';
  }
  if (orphaned.length === 0) return 'none';

  // The loud half: print regardless of what happens next.
  logger.blank();
  logger.warn(
    'Pre-0.3.2 data layout detected — deploying now would bring the instance up EMPTY:',
  );
  for (const pair of orphaned) {
    logger.warn(
      `  ${pair.legacy} still holds the Convex data, but the stack now reads ${pair.target} (missing).`,
    );
  }
  logger.warn(
    `Nothing is deleted, but the data does not move by itself — ${RUNBOOK_POINTER}.`,
  );

  const plan = orphaned.map((p) => `${p.legacy} → ${p.target}`).join(', ');

  if (opts.dryRun) {
    logger.info(
      `[DRY-RUN] Would offer to copy ${plan} (stack stopped, source read-only and preserved).`,
    );
    return 'dry-run';
  }

  if (!deps.canPrompt()) {
    logger.warn(
      'Non-interactive shell — NOT copying the data. Re-run `tale update` ' +
        'in a terminal (or with --yes) to migrate here, or follow the ' +
        'runbook before `tale deploy`.',
    );
    return 'declined';
  }

  const accepted = await deps.confirmCopy(
    `Copy the data across now (${plan})? Requires the stack to be stopped; the old volume is preserved.`,
  );
  if (!accepted) {
    logger.warn(
      `Data NOT copied — the next \`tale deploy\` brings the instance up ` +
        `empty. Before deploying, ${RUNBOOK_POINTER}.`,
    );
    return 'declined';
  }

  try {
    for (const pair of orphaned) {
      logger.step(`Copying ${pair.legacy} → ${pair.target}...`);
      await deps.copyVolume(pair, projectId);
    }
    logger.success(
      'Legacy Convex data copied. The old volume(s) are preserved; after ' +
        'verifying the deployed instance, reclaim the disk with:',
    );
    for (const pair of orphaned) {
      logger.info(`  docker volume rm ${pair.legacy}`);
    }
    return 'copied';
  } catch (err) {
    logger.error(
      `Legacy data copy failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    logger.warn(
      `Data NOT fully copied — do not \`tale deploy\` yet; ${RUNBOOK_POINTER}.`,
    );
    return 'failed';
  }
}
