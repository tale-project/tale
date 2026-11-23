import { BlockList, isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';

/**
 * Where the model relay listens (tale-project/tale#4942): on a port of its
 * own, and — on Docker, where `tale deploy` names the sandbox network's
 * subnet — on this container's address in that network alone, so the
 * relay is reached from a sandbox session and from nowhere else.
 */

export interface RelayListenEnv {
  SANDBOX_RELAY_LISTEN_HOST?: string | undefined;
  SANDBOX_NETWORK_SUBNET?: string | undefined;
  BACKEND_LISTEN_HOST?: string | undefined;
}

export type RelayAddress =
  | {
      /** The interface to bind; undefined binds every one. */
      host: string | undefined;
      /** Said once at start: where the relay is reachable from. */
      reach: string;
    }
  | { error: string };

/** The IPv4 addresses of this host's interfaces. */
function ipv4Addresses(
  interfaces: ReturnType<typeof networkInterfaces>,
): string[] {
  return Object.values(interfaces).flatMap((entries) =>
    (entries ?? []).flatMap((entry) =>
      entry.family === 'IPv4' && !entry.internal ? [entry.address] : [],
    ),
  );
}

/** A CIDR as a block to test addresses against, or null when it is not an
 * IPv4 CIDR. */
function subnetBlock(cidr: string): BlockList | null {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr.trim());
  if (match === null) return null;
  const [, network = '', bits = ''] = match;
  const prefix = Number(bits);
  if (!isIPv4(network) || prefix > 32) return null;
  const block = new BlockList();
  block.addSubnet(network, prefix, 'ipv4');
  return block;
}

/**
 * The address the relay binds:
 *
 *  - `SANDBOX_RELAY_LISTEN_HOST`, where an operator names one;
 *  - else, with `SANDBOX_NETWORK_SUBNET` set, this container's address in
 *    that subnet — an error when it has none, since the relay would then be
 *    reachable from no session (a container not attached to the sandbox
 *    network is a deployment's mistake, said at start rather than at the
 *    first turn);
 *  - else the API's own interface (`BACKEND_LISTEN_HOST`, every one when
 *    unset): Kubernetes, where a pod has one interface and a network policy
 *    says who reaches it, and a development host.
 */
export function relayListenAddress(
  env: RelayListenEnv,
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): RelayAddress {
  const explicit = env.SANDBOX_RELAY_LISTEN_HOST?.trim();
  if (explicit !== undefined && explicit !== '') {
    return { host: explicit, reach: `the address ${explicit}` };
  }
  const subnet = env.SANDBOX_NETWORK_SUBNET?.trim();
  if (subnet !== undefined && subnet !== '') {
    const block = subnetBlock(subnet);
    if (block === null) {
      return {
        error: `SANDBOX_NETWORK_SUBNET is not an IPv4 CIDR: ${subnet}`,
      };
    }
    const address = ipv4Addresses(interfaces).find((candidate) =>
      block.check(candidate, 'ipv4'),
    );
    if (address === undefined) {
      return {
        error: `this container has no address in the sandbox network ${subnet}, so no session could reach the model relay`,
      };
    }
    return { host: address, reach: `the sandbox network ${subnet} alone` };
  }
  const api = env.BACKEND_LISTEN_HOST?.trim();
  return api !== undefined && api !== ''
    ? { host: api, reach: `the address ${api}` }
    : { host: undefined, reach: 'every network this process is on' };
}
