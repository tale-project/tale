import * as defaultLogger from '../../utils/logger';
import { docker as defaultDocker } from './docker';

/** A `<slug>/<domain>` pair, as the compose file nests them. Anything else is
 *  dropped rather than reaching a shell. */
const TARGET_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Where the helper mounts the config volume — NOT `/app/data`, so the image's
 *  own ownership of that path stays readable underneath. */
const MOUNT_AT = '/mnt/config';

interface EnsureMountpointsDeps {
  docker: typeof defaultDocker;
  logger: Pick<typeof defaultLogger, 'warn'>;
}

/**
 * Create the org-config mountpoints inside the config volume, owned by the
 * user the app runs as.
 *
 * Two failures, one cause — the compose file nests a bind per
 * `<slug>/<domain>` inside `config-data`, which every app container mounts:
 *
 *  - runc creates any mountpoint it does not find, and cannot do so inside a
 *    read-only mount, so `platform` dies at start with "create mountpoint for
 *    /app/data/default/governance: read-only file system" whenever the volume
 *    does not already hold that directory.
 *  - Where runc CAN create it — the backend mounts the same volume
 *    read-write — it creates it as **root**, while the app process runs
 *    unprivileged. `/app/data` belongs to the app user but `/app/data/default`
 *    then does not, so the backend cannot seed
 *    `default/object-storage/connection.json` (`EACCES … mkdir`) and every
 *    upload and deliverable harvest afterwards fails with "No object storage
 *    configured: neither this org nor the deployment default tree has an
 *    object-storage/connection.json".
 *
 * The app image is what settles the ownership question: it ships `/app/data`
 * owned by the user it drops to, so the helper reads that owner rather than
 * hard-coding a uid that would rot the moment the image changes. A fresh
 * volume is root-owned and empty, so it cannot answer for itself.
 *
 * Idempotent and cheap, so it runs on every bring-up rather than trying to
 * detect a first one. Best-effort: on a volume that is already correct —
 * every bring-up after the first — failing here would block a stack that was
 * going to start anyway, so a failure warns and lets compose speak for itself.
 */
export async function ensureConfigMountpoints(
  volumeName: string,
  targets: readonly string[],
  appImage: string,
  {
    docker = defaultDocker,
    logger = defaultLogger,
  }: Partial<EnsureMountpointsDeps> = {},
): Promise<boolean> {
  const safe = targets.filter((t) => TARGET_PATTERN.test(t));
  if (safe.length === 0) {
    return true;
  }
  const dirs = [...new Set(safe.flatMap((t) => [t.split('/')[0] as string, t]))]
    .sort()
    .map((d) => `'${MOUNT_AT}/${d}'`)
    .join(' ');
  const result = await docker(
    'run',
    '--rm',
    '-v',
    `${volumeName}:${MOUNT_AT}`,
    '--entrypoint',
    'sh',
    appImage,
    '-c',
    `set -e; owner="$(stat -c '%u:%g' /app/data)"; mkdir -p ${dirs}; chown "$owner" ${dirs}`,
  );
  if (!result.success) {
    logger.warn(
      `Could not prepare the org config mountpoints in ${volumeName}: ` +
        `${result.stderr.trim()}. If the web tier fails to start with ` +
        '"create mountpoint … read-only file system", or the backend logs ' +
        '"default object store bootstrap failed", re-run `tale dev`.',
    );
    return false;
  }
  return true;
}
