import { Address4, Address6 } from 'ip-address';

import {
  ipv4Subnet,
  subnetsOverlap,
  isPrivateIpv4Subnet,
} from './network-address.ts';

// Docker's built-in local pools when `docker info` reports no override.
// https://docs.docker.com/engine/network/#automatic-subnet-allocation
const DEFAULT_POOLS = [
  { Base: '172.17.0.0/16', Size: 16 },
  { Base: '172.18.0.0/16', Size: 16 },
  { Base: '172.19.0.0/16', Size: 16 },
  { Base: '172.20.0.0/14', Size: 16 },
  { Base: '172.24.0.0/14', Size: 16 },
  { Base: '172.28.0.0/14', Size: 16 },
  { Base: '192.168.0.0/16', Size: 20 },
];
const INNER_DOCKER = new Address4('172.31.0.0/16');

export function assertBuildSubnet(subnet: Address4): void {
  if (!isPrivateIpv4Subnet(subnet)) {
    throw new Error(
      'buildkitd: private network must use an RFC1918 IPv4 subnet',
    );
  }
  if (subnetsOverlap(subnet, INNER_DOCKER)) {
    throw new Error(
      'buildkitd: private network overlaps the inner Docker 172.31.0.0/16 pool',
    );
  }
}

/** Validate every IPAM row. IPv6 ranges do not consume IPv4 space, but a
 * malformed row must not silently disappear from the overlap check. */
export function dockerIpv4Subnets(config: unknown): Address4[] {
  if (config === null) return [];
  if (!Array.isArray(config))
    throw new Error('buildkitd: invalid Docker IPAM inventory');
  return config.flatMap((entry: unknown) => {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      !('Subnet' in entry) ||
      typeof entry.Subnet !== 'string'
    ) {
      throw new Error('buildkitd: invalid Docker IPAM subnet');
    }
    if (entry.Subnet.includes(':')) {
      if (!Address6.isValid(entry.Subnet))
        throw new Error('buildkitd: invalid Docker IPv6 subnet');
      return [];
    }
    return [ipv4Subnet(entry.Subnet)];
  });
}

/** Add daemon-host routes and resolver addresses before an explicit claim.
 * Docker's automatic IPAM excludes these; explicit --subnet does not. */
export function daemonReservedSubnets(
  routes: unknown,
  resolvConf: string,
): Address4[] {
  if (!Array.isArray(routes))
    throw new Error('buildkitd: invalid daemon host route inventory');
  const reserved: Address4[] = [];
  const add = (value: string) =>
    reserved.push(ipv4Subnet(value.includes('/') ? value : `${value}/32`));
  for (const row of routes as unknown[]) {
    if (
      row === null ||
      typeof row !== 'object' ||
      !('dst' in row) ||
      typeof row.dst !== 'string'
    ) {
      throw new Error('buildkitd: invalid daemon host route');
    }
    if (row.dst !== 'default' && row.dst !== '0.0.0.0/0') add(row.dst);
    const attributes: Record<string, unknown> = Object.fromEntries(
      Object.entries(row),
    );
    for (const field of ['gateway', 'prefsrc'] as const) {
      if (field in attributes) {
        const value = attributes[field];
        if (typeof value !== 'string')
          throw new Error('buildkitd: invalid daemon host route address');
        add(value);
      }
    }
  }
  for (const line of resolvConf.split('\n')) {
    const [directive, address] = line.trim().split(/\s+/);
    if (directive !== 'nameserver') continue;
    if (!address) throw new Error('buildkitd: missing daemon resolver address');
    if (address.includes(':')) {
      if (!Address6.isValid(address))
        throw new Error('buildkitd: invalid daemon resolver address');
    } else add(address);
  }
  return reserved;
}

/** Pack explicit /23s into the first available daemon pool before advancing.
 * No persistent allocation ledger is needed: the complete Docker inventory is
 * the ledger. /23 holds 500 sessions plus helpers; smaller configured pools
 * remain smaller. Interval jumps avoid enumerating millions of occupied slots. */
export function selectBuildSubnet(
  configuredPools: unknown,
  occupied: readonly Address4[],
  excluded: ReadonlySet<string> = new Set(),
): string {
  const pools: unknown =
    configuredPools === null ||
    (Array.isArray(configuredPools) && configuredPools.length === 0)
      ? DEFAULT_POOLS
      : configuredPools;
  if (!Array.isArray(pools))
    throw new Error('buildkitd: invalid Docker default address pools');
  const reserved = [...occupied, INNER_DOCKER];
  for (const entry of pools as unknown[]) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      !('Base' in entry) ||
      !('Size' in entry) ||
      typeof entry.Size !== 'number' ||
      !Number.isInteger(entry.Size)
    ) {
      throw new Error('buildkitd: invalid Docker default address pool');
    }
    const pool = ipv4Subnet(entry.Base);
    if (entry.Size < pool.subnetMask || entry.Size > 32) {
      throw new Error('buildkitd: invalid Docker default pool size');
    }
    if (!isPrivateIpv4Subnet(pool)) continue;
    const prefix = Math.max(23, entry.Size);
    if (prefix > 29) continue;
    const step = 2 ** (32 - prefix);
    const end = Number(pool.endAddress().bigInt());
    let address = Number(pool.startAddress().bigInt());
    while (address <= end) {
      const subnet = `${Address4.fromInteger(address).correctForm()}/${prefix}`;
      const candidate = new Address4(subnet);
      let next = address;
      for (const range of reserved) {
        if (subnetsOverlap(candidate, range)) {
          next = Math.max(
            next,
            Math.ceil((Number(range.endAddress().bigInt()) + 1) / step) * step,
          );
        }
      }
      if (next > address) {
        address = next;
        continue;
      }
      if (!excluded.has(subnet)) return subnet;
      address += step;
    }
  }
  throw new Error(
    'buildkitd: no non-overlapping private subnet remains in Docker default address pools; configure additional RFC1918 pools or use local builds',
  );
}
