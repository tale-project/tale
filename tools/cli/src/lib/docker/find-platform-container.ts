import { getProjectId } from '../../utils/load-env';
import { isContainerRunning } from './is-container-running';
import { listContainers } from './list-containers';

export async function findPlatformContainer(): Promise<string> {
  const projectId = getProjectId();
  const blue = `${projectId}-platform-blue`;
  const green = `${projectId}-platform-green`;
  if (await isContainerRunning(blue)) {
    return blue;
  }
  if (await isContainerRunning(green)) {
    return green;
  }

  // Fallback: list containers under this project and match ONLY the exact
  // blue/green platform names. Permissive `/platform/` matching could pick up
  // unrelated containers such as `${projectId}-platform-build` or
  // user-created `${projectId}-platform-*` variants.
  const containers = await listContainers(`name=${projectId}`);
  const platform = containers.find(
    (c) => (c.name === blue || c.name === green) && c.status.startsWith('Up'),
  );
  if (platform) {
    return platform.name;
  }

  throw new Error(
    'No platform container is running. Start the platform first with: tale deploy',
  );
}
