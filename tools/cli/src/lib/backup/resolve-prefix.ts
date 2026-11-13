import { getProjectId } from '../../utils/load-env';
import { dockerRuntime } from '../runtime/docker/docker-runtime';
import type { StackRuntime } from '../runtime/types';
import { SNAPSHOT_VOLUMES } from './constants';

/**
 * Resolve which volume namespace this project's data lives under: the
 * production prefix (`${projectId}_`, created by `tale deploy`) wins over
 * the dev prefix (`${projectId}-dev_`, created by `tale dev`) when both
 * exist. Returns null when neither namespace has any data volume.
 *
 * Incus names a stack's volumes with no prefix (design D-27): its project is
 * the namespace, so the prefix is `''` once any data volume exists.
 */
export async function resolveSnapshotPrefix(
  runtime: StackRuntime = dockerRuntime,
): Promise<string | null> {
  const prefixes =
    runtime.engine === 'incus'
      ? ['']
      : [`${getProjectId()}_`, `${getProjectId()}-dev_`];
  for (const prefix of prefixes) {
    for (const volume of SNAPSHOT_VOLUMES) {
      if (await runtime.volumeExists(`${prefix}${volume}`)) {
        return prefix;
      }
    }
  }
  return null;
}
