/**
 * The org config store. Mounted at `TALE_CONFIG_DIR` (`/app/data`) in the
 * backend tier, it holds every `<org>/<domain>/*.json` config file —
 * including the object-storage connections the backup inspects to learn
 * where the blobs live.
 */
export const CONFIG_VOLUME = 'config-data';

/**
 * What the config store was called while Convex owned it. Docker cannot
 * rename a volume, so the CLI copies the contents across on the first
 * deploy / start / dev after the upgrade (`migrate-config-volume.ts`) and
 * leaves the old volume in place as an unused stub. The name survives here
 * for two reasons: teardown and detection still have to see the stub, and a
 * snapshot taken before the migration files its config archive under it.
 */
export const LEGACY_CONFIG_VOLUME = 'convex-data';

/**
 * The blob store's data: uploaded files, chat attachments, audio, generated
 * media — non-rederivable, and as large as the store. Captured whenever the
 * deployment default points at the bundled `object-store`; left out only
 * when the default is an external S3 (see inspect-blob-store.ts).
 */
export const BLOB_VOLUME = 'object-store-data';

/**
 * Volumes captured by a snapshot: every project volume that holds
 * non-rederivable state. `db-backup` is excluded (never back up backups —
 * nothing writes to it today anyway) along with the legacy `platform-data`
 * stub (see DEV_VOLUME_NAMES in ../compose/generators/constants.ts).
 */
export const SNAPSHOT_VOLUMES = [
  'db-data',
  CONFIG_VOLUME,
  BLOB_VOLUME,
  'caddy-data',
  'caddy-config',
] as const;

/**
 * Archive names a RESTORE accepts, which is a superset of what a snapshot
 * writes: a snapshot taken before the config-volume rename filed the config
 * tree as `convex-data.tar.gz`, and dropping it would restore a deployment
 * with an empty config store — silently, since the manifest filter is what
 * decides. {@link restoreTargetVolume} maps each name onto the LIVE volume
 * it belongs in.
 */
export const RESTORABLE_ARCHIVES = [
  ...SNAPSHOT_VOLUMES,
  LEGACY_CONFIG_VOLUME,
] as const;

/** The live volume an archive of this name restores into. */
export function restoreTargetVolume(archive: string): string {
  return archive === LEGACY_CONFIG_VOLUME ? CONFIG_VOLUME : archive;
}

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
 * Bounds on a single volume's tar (snapshot) or extract (restore). The
 * database, config and proxy volumes are small and settle in minutes; the
 * blob store is as large as everything ever uploaded and gets a bound that
 * covers a store in the hundreds of gigabytes. Both bounds guard against a
 * hung docker, not against a slow but progressing archive — the snapshot
 * side pauses the volume's containers for the duration either way.
 */
const ARCHIVE_TIMEOUT_SECONDS = 1800;
const BLOB_ARCHIVE_TIMEOUT_SECONDS = 4 * 3600;

export function archiveTimeoutSeconds(volume: string): number {
  return volume === BLOB_VOLUME
    ? BLOB_ARCHIVE_TIMEOUT_SECONDS
    : ARCHIVE_TIMEOUT_SECONDS;
}

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
