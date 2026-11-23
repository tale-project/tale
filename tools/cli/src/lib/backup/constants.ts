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
 *
 * The store is versitygw (tale-project/tale#4942), which keeps an object as
 * a file under its bucket's directory and what S3 says of it (its content
 * type, its ETag, its checksums) in that file's extended attributes. So
 * whatever archives or copies this volume has to keep them
 * ({@link keepsExtendedAttributes}).
 */
export const BLOB_VOLUME = 'blob-data';

/**
 * The blob store's volume while MinIO was the store, in MinIO's own format.
 * A deployment that still runs MinIO has its blobs here, and one that was
 * moved keeps the volume as it was, until its operator removes it. Which of
 * the two holds a deployment's blobs is read from what is in them
 * (live-blob-volume.ts). The name also survives in snapshots: one taken on
 * MinIO files its blobs under it.
 */
export const LEGACY_BLOB_VOLUME = 'object-store-data';

/**
 * The store of the sandbox LLM gateway that earlier releases ran, which the
 * model relay in the backend replaced (tale-project/tale#4942): SQLite
 * databases holding its admin account, providers and their keys, the keys it
 * minted with their budgets and spend, and its request log. A deployment keeps
 * the volume until its operator removes it (RETIRED_VOLUMES in
 * ../compose/generators/constants.ts), and no snapshot takes it any more; one
 * taken while the gateway ran holds its archive, which a restore still puts
 * back.
 */
export const GATEWAY_VOLUME = 'llm-gateway-data';

/**
 * Volumes captured by a snapshot: every project volume that holds
 * non-rederivable state. `db-backup` is excluded (never back up backups —
 * nothing writes to it today anyway) along with the legacy `platform-data`
 * stub (see DEV_VOLUME_NAMES in ../compose/generators/constants.ts).
 */
export const SNAPSHOT_VOLUMES = [
  'db-data',
  // The source-Compose layout keeps its knowledge corpus in a separate
  // Postgres volume. Capturing only the application DB cannot restore it.
  'knowledge-db-data',
  CONFIG_VOLUME,
  BLOB_VOLUME,
  'caddy-data',
  'caddy-config',
  // The edge's ACME account and certificates, and the self-signed CA a
  // device may already trust.
  'proxy-data',
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
  // A snapshot taken while MinIO was the store. It restores into the volume
  // of that name, where the deployment's blobs then are again, in MinIO's
  // format.
  LEGACY_BLOB_VOLUME,
  // A snapshot taken while the model gateway ran. It restores into the
  // gateway's volume, which the release the snapshot names starts its
  // gateway on again.
  GATEWAY_VOLUME,
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
 * The helper image for a volume whose files carry extended attributes
 * ({@link keepsExtendedAttributes}). The tar of {@link BACKUP_HELPER_IMAGE}
 * is busybox's, which neither stores them nor puts them back: an archive of
 * the blob store made with it restores every object without its content
 * type and its ETag. Debian's tar is GNU tar, which keeps them when asked.
 *
 * Pinned by the digest the images of this repository are built on, so the
 * tar that wrote an archive is the tar that reads it
 * (`backup/helper-image.test.ts` holds the two pins together).
 *
 * Docker runs a helper job from the image it names. Incus runs every job in
 * the release's `tale-proxy` image (design D-30), whose tar is busybox's:
 * there the archive of this volume's native snapshot and a runtime
 * migration do not keep the attributes yet. The Incus runtime does not run
 * this line's stack (tale-project/tale#5282) and has to bring a tar that
 * keeps them when it does.
 */
export const XATTR_HELPER_IMAGE =
  'debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587';

/** Whether a volume's files carry extended attributes that are part of its
 * data: the blob store's, where versitygw keeps each object's metadata. */
export function keepsExtendedAttributes(volume: string): boolean {
  return volume === BLOB_VOLUME;
}

/**
 * How a helper tars and extracts a volume: the image to run, and what its
 * tar is told after the archive's name. A volume of extended attributes
 * gets the tar that keeps them, and is told to: `user.*` is where
 * versitygw writes, and all that an unprivileged store can.
 */
export function tarHelper(volume: string): { image: string; flags: string } {
  return keepsExtendedAttributes(volume)
    ? {
        image: XATTR_HELPER_IMAGE,
        flags: " --xattrs --xattrs-include='user.*'",
      }
    : { image: BACKUP_HELPER_IMAGE, flags: '' };
}

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
  return volume === BLOB_VOLUME || volume === LEGACY_BLOB_VOLUME
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
