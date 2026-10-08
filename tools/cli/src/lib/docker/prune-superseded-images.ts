import { compareVersions, extractVersion } from '../../utils/compare-versions';
import * as defaultLogger from '../../utils/logger';
import { docker as defaultDocker } from './docker';

interface PruneSupersededImagesDeps {
  docker: typeof defaultDocker;
  logger: Pick<typeof defaultLogger, 'info' | 'warn' | 'debug'>;
}

export interface PruneSupersededImagesResult {
  /** References removed (or, in a dry run, that would be). */
  removed: string[];
  /** References a container still uses; a later deploy removes them. */
  inUse: string[];
  /** References whose removal failed for another reason. */
  failed: string[];
}

/** `docker image rm` refuses a reference a container (running or not) uses. */
const IN_USE =
  /being used by|is using its referenced image|conflict: unable to remove/i;

/**
 * Remove the images of versions older than every version `keep` names.
 *
 * `tale deploy` pulls each image of the new version by its version tag, so the
 * versions it replaced keep their own tags: they are not dangling, and no
 * prune removed them. Every release left its predecessor's images on the host,
 * the sandbox runtime alone about 6 GB unpacked.
 *
 * Touches only `<registry>/tale-*` repositories and only release tags strictly
 * older than the oldest kept version, so the version now live, the rollback
 * target and an image loaded ahead for a later version all stay. Removal never
 * forces: Docker refuses an image a container still uses — a stop-gated
 * service left running on an older version, or a sandbox session that started
 * before this deploy — and a later deploy removes it once it is free.
 *
 * Best-effort: a failure is reported and never fails the deploy.
 */
export async function pruneSupersededImages(
  registry: string,
  keep: readonly (string | null | undefined)[],
  {
    dryRun = false,
    docker = defaultDocker,
    logger = defaultLogger,
  }: Partial<PruneSupersededImagesDeps> & { dryRun?: boolean } = {},
): Promise<PruneSupersededImagesResult> {
  const result: PruneSupersededImagesResult = {
    removed: [],
    inUse: [],
    failed: [],
  };
  const kept = keep.filter(
    (version): version is string =>
      typeof version === 'string' && extractVersion(version) !== null,
  );
  if (kept.length === 0) return result;
  const oldestKept = kept.reduce((oldest, version) =>
    compareVersions(version, oldest) < 0 ? version : oldest,
  );

  const listing = await docker(
    'image',
    'ls',
    '--format',
    '{{.Repository}}:{{.Tag}}',
  );
  if (!listing.success) {
    logger.warn(
      `Could not list images to remove earlier versions: ${listing.stderr.trim()}`,
    );
    return result;
  }

  const prefix = `${registry.replace(/\/+$/, '')}/tale-`;
  const tagOf = (reference: string) =>
    reference.slice(reference.lastIndexOf(':') + 1).replace(/^v/, '');
  const older = [
    ...new Set(
      listing.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((reference) => reference.startsWith(prefix)),
    ),
  ].filter((reference) => {
    const tag = tagOf(reference);
    // A release tag: the whole tag is a version, so `latest`, branch and pull
    // request tags never match.
    if (extractVersion(tag) !== tag) return false;
    return compareVersions(tag, oldestKept) < 0;
  });
  // Without a distinct rollback target (a first deploy, or a redeploy of the
  // live version, which records itself), the newest earlier version stays as
  // the fallback a rollback would want.
  const distinctKept = new Set(
    kept.map((version) => version.replace(/^v/, '')),
  );
  const fallback =
    distinctKept.size > 1
      ? undefined
      : older
          .map(tagOf)
          .reduce<string | undefined>(
            (newest, tag) =>
              newest === undefined || compareVersions(tag, newest) > 0
                ? tag
                : newest,
            undefined,
          );
  const superseded = older.filter((reference) => tagOf(reference) !== fallback);

  for (const reference of superseded) {
    if (dryRun) {
      result.removed.push(reference);
      continue;
    }
    // One at a time: a deploy host is serving traffic while this runs.
    const removal = await docker('image', 'rm', reference);
    if (removal.success) result.removed.push(reference);
    else if (IN_USE.test(removal.stderr)) result.inUse.push(reference);
    else {
      result.failed.push(reference);
      logger.debug(`Could not remove ${reference}: ${removal.stderr.trim()}`);
    }
  }

  if (result.removed.length > 0) {
    logger.info(
      `${dryRun ? 'Would remove' : 'Removed'} ${result.removed.length} image(s) of versions before ${oldestKept}.`,
    );
  }
  if (result.inUse.length > 0) {
    logger.info(
      `Kept ${result.inUse.length} earlier image(s) still in use; a later deploy removes them.`,
    );
  }
  if (result.failed.length > 0) {
    logger.warn(
      `Could not remove ${result.failed.length} earlier image(s): ${result.failed.join(', ')}`,
    );
  }
  return result;
}
