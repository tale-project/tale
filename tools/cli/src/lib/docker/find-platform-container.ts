import { isContainerRunning } from './is-container-running';
import { listContainers } from './list-containers';

export async function findPlatformContainer(): Promise<string> {
  if (await isContainerRunning('tale-platform-blue')) {
    return 'tale-platform-blue';
  }
  if (await isContainerRunning('tale-platform-green')) {
    return 'tale-platform-green';
  }

  const containers = await listContainers('name=tale');
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
