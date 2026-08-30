/**
 * Volumes captured by a snapshot: every project volume that holds
 * non-rederivable state. `db-backup` is excluded (never back up backups —
 * nothing writes to it today anyway) along with the legacy `platform-data`
 * stub (see DEV_VOLUME_NAMES in ../compose/generators/constants.ts).
 */
export const SNAPSHOT_VOLUMES = [
  'db-data',
  // The org config store. The name predates the Convex retirement and is
  // kept so no operator has to migrate a volume for a rename.
  'convex-data',
  'caddy-data',
  'caddy-config',
] as const;

/**
 * Logical name of the project-scoped volume snapshots are written into
 * (`${prefix}backups`). A docker volume rather than a host path keeps the
 * snapshots inside the same lifecycle/permission model as the data they
 * protect and avoids host-path UID mismatches across platforms.
 */
export const BACKUP_VOLUME = 'backups';

/**
 * Pinned helper image for the tar/sha256/rm operations run inside volumes.
 * Pinned so a surprise alpine major bump can't change tar semantics
 * between the snapshot that wrote an archive and the restore that reads it.
 */
export const BACKUP_HELPER_IMAGE = 'alpine:3.22';

/**
 * Snapshot ids are CLI-generated (`<YYYYMMDD>-<HHMMSS>-<trigger>`), but they
 * round-trip through manifests stored on the backups volume and back into
 * shell commands (rotation `rm -rf`, restore `tar xzf`). Validate the shape
 * at every read so a hand-edited manifest cannot smuggle shell
 * metacharacters into those commands.
 */
const SNAPSHOT_ID_RE = /^[0-9]{8}-[0-9]{6}-[a-z]+$/;

export function isValidSnapshotId(id: string): boolean {
  return SNAPSHOT_ID_RE.test(id);
}
