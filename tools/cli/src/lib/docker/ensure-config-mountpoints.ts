import * as defaultLogger from '../../utils/logger';
import { BACKUP_HELPER_IMAGE } from '../backup/constants';
import { docker as defaultDocker } from './docker';

interface EnsureMountpointsDeps {
  docker: typeof defaultDocker;
  logger: Pick<typeof defaultLogger, 'warn'>;
}

/**
 * Create the org-config mountpoints inside the config volume.
 *
 * The web tier mounts `config-data:/app/data:ro` and the dev compose nests one
 * bind per `<slug>/<domain>` underneath it. runc creates a mountpoint it does
 * not find — and cannot, inside a read-only mount — so the container fails to
 * start with "create mountpoint for /app/data/<slug>/<domain>: read-only file
 * system" whenever the volume does not already hold that directory. The
 * backend creates them when it seeds the volume, but it does that while the
 * web tier is starting, so on a first bring-up the two race and the loser is
 * an unrecoverable OCI error rather than a retry.
 *
 * Idempotent and cheap (one short-lived helper container), so it runs on every
 * bring-up rather than trying to detect a first one.
 *
 * Best-effort: on a volume that already has the directories — every bring-up
 * after the first — failing here would block a stack that was going to start
 * anyway, so a failure warns and lets compose speak for itself.
 */
export async function ensureConfigMountpoints(
  volumeName: string,
  targets: readonly string[],
  {
    docker = defaultDocker,
    logger = defaultLogger,
  }: Partial<EnsureMountpointsDeps> = {},
): Promise<boolean> {
  if (targets.length === 0) {
    return true;
  }
  // `--` and the `/d/` prefix keep a slug that starts with a dash, or one
  // carrying a traversal, from being read as an option or escaping the mount.
  const paths = targets.map((t) => `/d/${t.replace(/\.\./g, '')}`);
  const result = await docker(
    'run',
    '--rm',
    '-v',
    `${volumeName}:/d`,
    BACKUP_HELPER_IMAGE,
    'mkdir',
    '-p',
    '--',
    ...paths,
  );
  if (!result.success) {
    logger.warn(
      `Could not pre-create the org config mountpoints in ${volumeName}: ` +
        `${result.stderr.trim()}. If the web tier fails to start with ` +
        '"create mountpoint … read-only file system", re-run `tale dev`.',
    );
    return false;
  }
  return true;
}
