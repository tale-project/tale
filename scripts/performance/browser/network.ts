import assert from 'node:assert/strict';

import type { ResourceIO } from './linux-resources.ts';

export interface NetworkReadback {
  namespace: string;
  interfaces: string;
  addresses6: string;
  routes4: string;
  routes6: string;
  disableIpv6: string;
}

/** Linux's rejected default sentinels do not provide a usable route. */
export function assertPrivateLoopback(value: NetworkReadback) {
  assert.match(value.namespace.trim(), /^net:\[\d+\]$/);
  assert.equal(value.disableIpv6.trim(), '0');
  const interfaces = value.interfaces
    .split('\n')
    .filter((line) => line.includes(':'))
    .map((line) => line.split(':')[0]!.trim());
  assert.deepEqual(
    interfaces,
    ['lo'],
    'Private namespace has a non-loopback interface',
  );
  const addresses = value.addresses6
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/));
  assert.equal(addresses.length, 1, 'Expected only the IPv6 loopback address');
  const [address, index, prefix, scope, flags, device] = addresses[0]!;
  assert.equal(address, '00000000000000000000000000000001');
  assert.match(index ?? '', /^[a-f0-9]+$/i);
  assert.equal(prefix, '80');
  assert.equal(scope, '10');
  assert.match(flags ?? '', /^[a-f0-9]+$/i);
  assert.equal(
    Number.parseInt(flags!, 16) & 0x40,
    0,
    'IPv6 loopback is tentative',
  );
  assert.equal(device, 'lo');
  const routes4 = value.routes4.trim().split('\n');
  assert.match(routes4.shift() ?? '', /^Iface\s+Destination\s+Gateway\s+/);
  for (const line of routes4.filter(Boolean)) {
    const fields = line.trim().split(/\s+/);
    assert.equal(fields.length, 11, 'Malformed IPv4 route');
    assert.equal(fields[0], 'lo');
    assert.equal(
      fields[2],
      '00000000',
      'Private namespace has an IPv4 gateway',
    );
    assert.match(fields[1]!, /^[a-f0-9]{8}$/i);
    assert.match(fields[7]!, /^[a-f0-9]{8}$/i);
    assert.equal(
      Number.parseInt(fields[1]!, 16) & 255,
      127,
      'Non-loopback IPv4 route',
    );
    assert.equal(
      Number.parseInt(fields[7]!, 16) & 255,
      255,
      'Default/broad IPv4 route',
    );
  }
  let hasLoopbackRoute = false;
  for (const line of value.routes6.trim().split('\n').filter(Boolean)) {
    const fields = line.trim().split(/\s+/);
    assert.equal(fields.length, 10, 'Malformed IPv6 route');
    assert.equal(fields[9], 'lo');
    assert.equal(
      fields[4],
      '0'.repeat(32),
      'Private namespace has an IPv6 gateway',
    );
    assert.match(fields[8]!, /^[a-f0-9]{8}$/i);
    const rejectedDefault =
      fields[0] === '0'.repeat(32) &&
      fields[1] === '00' &&
      (Number.parseInt(fields[8]!, 16) & 0x200) !== 0;
    const loopback = fields[0] === '0'.repeat(31) + '1' && fields[1] === '80';
    hasLoopbackRoute ||= loopback;
    assert(
      rejectedDefault || loopback,
      'Private namespace has a usable external IPv6 route',
    );
  }
  assert(hasLoopbackRoute, 'IPv6 loopback route is missing');
}

export function assertSharedNetwork(
  db: NetworkReadback & { networkMode: string },
  browser: NetworkReadback & { networkMode: string },
  dbId: string,
) {
  assert.match(dbId, /^[a-f0-9]{64}$/);
  assert.equal(db.networkMode, 'none');
  assert.equal(browser.networkMode, `container:${dbId}`);
  assertPrivateLoopback(db);
  assertPrivateLoopback(browser);
  assert.equal(
    browser.namespace.trim(),
    db.namespace.trim(),
    'Measured processes do not share the owned private namespace',
  );
}

export async function readContainerNetwork(io: ResourceIO, id: string) {
  assert.match(id, /^[a-f0-9]{64}$/);
  const mode = await io.command(
    'docker',
    ['inspect', '--format', '{{.HostConfig.NetworkMode}}', id],
    5000,
  );
  assert.equal(mode.code, 0, 'Owned container network inspection failed');
  const command = async (args: string[]) => {
    const result = await io.command('docker', ['exec', id, ...args], 5000);
    assert.equal(result.code, 0, 'Owned namespace readback failed');
    return result.stdout;
  };
  const value: NetworkReadback = {
    namespace: await command(['readlink', '/proc/self/ns/net']),
    interfaces: await command(['cat', '/proc/net/dev']),
    addresses6: await command(['cat', '/proc/net/if_inet6']),
    routes4: await command(['cat', '/proc/net/route']),
    routes6: await command(['cat', '/proc/net/ipv6_route']),
    disableIpv6: await command([
      'cat',
      '/proc/sys/net/ipv6/conf/all/disable_ipv6',
    ]),
  };
  return { ...value, networkMode: mode.stdout.trim() };
}
