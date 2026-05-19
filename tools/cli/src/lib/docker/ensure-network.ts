import { getProjectId } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { docker } from './docker';

async function networkExists(networkName: string): Promise<boolean> {
  const result = await docker('network', 'inspect', networkName);
  return result.success;
}

async function createNetwork(
  networkName: string,
  extraArgs: string[] = [],
): Promise<boolean> {
  const exists = await networkExists(networkName);
  if (exists) {
    logger.debug(`Network ${networkName} already exists`);
    return true;
  }

  logger.info(`Creating network: ${networkName}`);
  const result = await docker(
    'network',
    'create',
    '--label',
    `project=${getProjectId()}`,
    ...extraArgs,
    networkName,
  );
  if (!result.success) {
    logger.error(
      `Failed to create network ${networkName}: ${result.stderr.trim()}`,
    );
  }
  return result.success;
}

export async function ensureNetwork(
  networkName: string,
  prefix: string = `${getProjectId()}_`,
): Promise<boolean> {
  const fullName = `${prefix}${networkName}`;
  return createNetwork(fullName);
}

/**
 * The sandbox network is shared across blue/green and across dev/prod —
 * it's pinned to a fixed Docker name (`tale-sandbox-net`) so the spawner
 * can `docker run --network tale-sandbox-net` without discovering the
 * compose-project-prefixed default. `--internal` blocks all internet
 * from this network so the per-call runtime containers can only reach
 * pypi/npm via the egress proxy sidecar.
 */
export async function ensureSandboxNetwork(): Promise<boolean> {
  return createNetwork('tale-sandbox-net', [
    '--internal',
    '--ipv6=false',
    '--driver=bridge',
  ]);
}
