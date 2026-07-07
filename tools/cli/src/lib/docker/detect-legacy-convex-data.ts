import * as logger from '../../utils/logger';
import { readProject } from '../project/read-project';
import { volumeExists } from './ensure-volumes';

/**
 * Pre-0.3.2 volume-layout detection (P1-8, #1755).
 *
 * Versions 0.3.1 and earlier stored the Convex backend's data in
 * `<scope>_platform-data` (and installs older than 0.2.33 used the fixed
 * `tale` project name instead of a per-project id). The split into a
 * dedicated convex service moved that data to `<scope>_convex-data`, and
 * the one-shot copy migration was removed with the org-first config-layout
 * refactor — so an operator upgrading straight across that boundary gets a
 * fresh empty `convex-data` volume on deploy while the original data sits
 * orphaned in `platform-data`: silent data loss from the user's view.
 *
 * This is the conservative detect+warn half of the fallback: flag every
 * legacy source volume whose destination volume does not exist yet and
 * point at the manual runbook in docs/self-hosted/operate/upgrades.md.
 * Detection is existence-only (no data inspection, no container runs) and
 * best-effort — an unreachable Docker daemon must never fail `tale update`.
 * Once the destination volume exists (modern deploys pre-create it), the
 * check stays silent: it cannot tell a migrated volume from a fresh one
 * without mounting it, and warning on every run would be noise.
 */

/** Pre-0.2.33 fixed compose project name (`docker compose -p tale`). */
const LEGACY_PROJECT_NAME = 'tale';

interface OrphanedDataVolume {
  /** The pre-0.3.2 volume that still holds the Convex data. */
  legacy: string;
  /** The volume the current compose files mount instead. */
  target: string;
}

/**
 * Return every `platform-data` volume that exists while its `convex-data`
 * destination does not — the constellation where the next `tale deploy`
 * would bring the instance up empty. `volumeExistsFn` is injectable for
 * tests; production uses the real `docker volume inspect` probe.
 */
export async function findOrphanedConvexDataVolumes(
  projectId: string,
  volumeExistsFn: (name: string) => Promise<boolean> = volumeExists,
): Promise<OrphanedDataVolume[]> {
  const candidates: OrphanedDataVolume[] = [
    {
      legacy: `${projectId}_platform-data`,
      target: `${projectId}_convex-data`,
    },
    {
      legacy: `${projectId}-dev_platform-data`,
      target: `${projectId}-dev_convex-data`,
    },
    {
      legacy: `${LEGACY_PROJECT_NAME}_platform-data`,
      target: `${projectId}_convex-data`,
    },
    {
      legacy: `${LEGACY_PROJECT_NAME}-dev_platform-data`,
      target: `${projectId}-dev_convex-data`,
    },
  ];
  const orphaned: OrphanedDataVolume[] = [];
  const seen = new Set<string>();
  for (const pair of candidates) {
    // Dedupe: a project literally named `tale` would list each pair twice.
    if (seen.has(pair.legacy)) continue;
    seen.add(pair.legacy);
    if (!(await volumeExistsFn(pair.legacy))) continue;
    if (await volumeExistsFn(pair.target)) continue;
    orphaned.push(pair);
  }
  return orphaned;
}

/**
 * Best-effort warning used by `tale update`: never throws. Reads the
 * project id from `tale.json` (a legacy project without one gets its id
 * assigned on the next deploy — nothing to check yet) and probes Docker;
 * any failure along the way is a debug line, not an error.
 */
export async function warnOnOrphanedConvexData(
  projectDir: string,
): Promise<void> {
  try {
    const projectId = (await readProject(projectDir)).id;
    if (typeof projectId !== 'string' || projectId.trim() === '') return;
    const orphaned = await findOrphanedConvexDataVolumes(projectId);
    if (orphaned.length === 0) return;
    logger.warn(
      `Pre-0.3.2 data layout detected: ` +
        orphaned
          .map((p) => `${p.legacy} exists but ${p.target} does not`)
          .join('; ') +
        `. Since 0.3.2 the Convex backend reads its data from ` +
        `convex-data — deploying without copying the data across brings ` +
        `the instance up EMPTY (the old volume is preserved but unused). ` +
        `Copy the data first: see "Upgrading from 0.3.1 or earlier" in ` +
        `docs/self-hosted/operate/upgrades.md.`,
    );
  } catch (err) {
    // Docker unavailable, tale.json unreadable, … — the warning is
    // best-effort and must never block an update.
    logger.debug(`legacy volume detection skipped: ${String(err)}`);
  }
}
