import { getProjectId } from '../../utils/load-env';
import { volumeExists } from '../docker/ensure-volumes';
import { SNAPSHOT_VOLUMES } from './constants';

/**
 * Resolve which volume namespace this project's data lives under: the
 * production prefix (`${projectId}_`, created by `tale deploy`) wins over
 * the dev prefix (`${projectId}-dev_`, created by `tale dev`) when both
 * exist. Returns null when neither namespace has any data volume.
 */
export async function resolveSnapshotPrefix(): Promise<string | null> {
  const prefixes = [`${getProjectId()}_`, `${getProjectId()}-dev_`];
  for (const prefix of prefixes) {
    for (const volume of SNAPSHOT_VOLUMES) {
      if (await volumeExists(`${prefix}${volume}`)) {
        return prefix;
      }
    }
  }
  return null;
}
