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
 *
 * Defense-in-depth: if a network with this name already exists, verify
 * `--internal` is still in effect. A stale or hand-rolled network without
 * `--internal` would let runtime containers reach arbitrary hosts on the
 * default bridge, defeating the whole egress-proxy model.
 */
export async function ensureSandboxNetwork(): Promise<boolean> {
  const name = 'tale-sandbox-net';
  const existed = await networkExists(name);
  if (existed) {
    const inspect = await docker(
      'network',
      'inspect',
      '--format',
      '{{.Internal}}|{{.EnableIPv6}}',
      name,
    );
    if (inspect.success) {
      const [internalStr, ipv6Str] = inspect.stdout.trim().split('|');
      if (internalStr !== 'true') {
        logger.error(
          `Sandbox network ${name} exists but is NOT internal (Internal=${internalStr}). ` +
            `Runtime containers would have direct internet access, defeating egress filtering. ` +
            `Remove the existing network ("docker network rm ${name}") and retry, or recreate with --internal.`,
        );
        return false;
      }
      if (ipv6Str === 'true') {
        // We deliberately disable IPv6 on the sandbox network so the
        // entrypoint's iptables (v4) rules are a complete fence. A
        // v6-enabled network would route around them.
        logger.warn(
          `Sandbox network ${name} has IPv6 enabled (EnableIPv6=true). ` +
            `Recommended: recreate with --ipv6=false so iptables (v4-only) covers the full egress surface.`,
        );
      }
    } else {
      logger.warn(
        `Could not inspect existing sandbox network ${name}: ${inspect.stderr.trim()}`,
      );
    }
    return true;
  }
  return createNetwork(name, ['--internal', '--ipv6=false', '--driver=bridge']);
}
