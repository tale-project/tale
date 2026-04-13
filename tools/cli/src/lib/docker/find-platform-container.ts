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

  const containers = await listContainers(`name=${projectId}`);
  const platform = containers.find(
    (c) => /platform/.test(c.name) && c.status.startsWith('Up'),
  );
  if (platform) {
    return platform.name;
  }

  throw new Error(
    'No platform container is running. Start the platform first with: tale deploy',
  );
}
