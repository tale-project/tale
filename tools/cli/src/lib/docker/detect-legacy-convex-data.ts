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
 * This module is the detection half: flag every legacy source volume whose
 * destination volume does not exist yet. The remedy — the loud warning and
 * the offered copy in `tale update` — lives in
 * migrate-legacy-convex-data.ts, and the manual fallback in
 * docs/self-hosted/operate/upgrades.md. Detection is existence-only (no
 * data inspection, no container runs). Once the destination volume exists
 * (modern deploys pre-create it, and a completed copy creates it too), the
 * check stays silent: it cannot tell a migrated volume from a fresh one
 * without mounting it, and warning on every run would be noise.
 */

/** Pre-0.2.33 fixed compose project name (`docker compose -p tale`). */
const LEGACY_PROJECT_NAME = 'tale';

export interface OrphanedDataVolume {
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
