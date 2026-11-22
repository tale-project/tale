import { LEGACY_BLOB_VOLUME } from '../backup/constants';
import { liveBlobVolume } from '../backup/live-blob-volume';
import type { ObjectStoreEngine } from '../compose/types';
import { dockerRuntime } from '../runtime/docker/docker-runtime';
import type { StackRuntime } from '../runtime/types';

/**
 * Which server the bundled blob store of this deployment runs
 * (tale-project/tale#4942): MinIO where the blobs are still in MinIO's
 * volume, versitygw everywhere else, a fresh install included.
 *
 * Read from the volumes on every deploy, rollback and dev bring-up, before
 * an image is pulled or a compose document written, and never from a
 * setting (`backup/live-blob-volume.ts` says why). A look that fails throws
 * and stops its caller: started on a guess, the wrong server would serve an
 * empty store beside a full one, or write its own files among the other's.
 */
export async function resolveObjectStore(
  prefix: string,
  runtime: StackRuntime = dockerRuntime,
): Promise<ObjectStoreEngine> {
  return (await liveBlobVolume(prefix, runtime)) === LEGACY_BLOB_VOLUME
    ? 'minio'
    : 'versitygw';
}

/** What a deploy says of a blob store it keeps on MinIO. */
export function minioNotice(prefix: string): string {
  return `The blob store stays MinIO: this deployment's blobs are in ${prefix}${LEGACY_BLOB_VOLUME}, in MinIO's format. A new install runs versitygw.`;
}
