import type { StackRuntime } from '../runtime/types';
import {
  BACKUP_HELPER_IMAGE,
  BLOB_VOLUME,
  LEGACY_BLOB_VOLUME,
} from './constants';

/** One of the two volumes a deployment's blobs may be in. */
export type BlobVolume = typeof BLOB_VOLUME | typeof LEGACY_BLOB_VOLUME;

/** Find probe: any top-level name except `lost+found` (ext filesystems). */
const CONTENT_PROBE =
  'find /data -mindepth 1 -maxdepth 1 ! -name lost+found -print -quit';

/**
 * Is the volume there AND holding at least one real entry? A probe that
 * fails throws: taking "could not look" for "empty" would pass over a
 * store full of blobs.
 */
async function hasContent(
  runtime: StackRuntime,
  volumeName: string,
): Promise<boolean> {
  if (!(await runtime.volumeExists(volumeName))) return false;
  const result = await runtime.oneShot({
    image: BACKUP_HELPER_IMAGE,
    purpose: 'probe',
    mounts: [{ volume: volumeName, target: '/data', readOnly: true }],
    argv: ['sh', '-c', CONTENT_PROBE],
  });
  if (!result.success) {
    throw new Error(
      `Could not inspect ${volumeName} for existing blobs: ${
        result.stderr.trim() || result.stdout.trim() || 'the helper failed'
      }. Nothing was changed.`,
    );
  }
  return result.stdout.trim().length > 0;
}

/**
 * Which volume holds this deployment's blobs (tale-project/tale#4942).
 *
 * The blob store used to be MinIO, on `object-store-data`; it is versitygw,
 * on `blob-data`. The two keep their files in formats neither reads of the
 * other, so nothing may ever start one on the other's volume, and a
 * deployment is on whichever its blobs are in:
 *
 *   1. `blob-data` has content: versitygw's volume is the live one.
 *   2. it has none and `object-store-data` has: the deployment still runs
 *      MinIO.
 *   3. neither has: a fresh install, which gets versitygw.
 *
 * Content decides, not existence, and not a setting. `ensureVolumes` creates
 * every volume of the stack on every run, so `blob-data` exists, empty, on a
 * deployment whose blobs are all in MinIO's. And a volume that was restored
 * or copied says what it holds, where a line in `.env` would say what
 * someone once wrote.
 */
export async function liveBlobVolume(
  prefix: string,
  runtime: StackRuntime,
): Promise<BlobVolume> {
  if (await hasContent(runtime, `${prefix}${BLOB_VOLUME}`)) return BLOB_VOLUME;
  return (await hasContent(runtime, `${prefix}${LEGACY_BLOB_VOLUME}`))
    ? LEGACY_BLOB_VOLUME
    : BLOB_VOLUME;
}
