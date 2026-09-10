import { describe, expect, test } from 'bun:test';

import { Address4 } from 'ip-address';

import {
  assertBuildSubnet,
  daemonReservedSubnets,
  dockerIpv4Subnets,
  selectBuildSubnet,
} from './buildkit-network-pool.ts';
import { ipv4Subnet, subnetsOverlap } from './network-address.ts';

describe('organization build subnet allocation', () => {
  test('packs one /16 before advancing to the next default pool', () => {
    const used = [ipv4Subnet('172.17.0.0/16'), ipv4Subnet('172.18.0.0/16')];
    for (let index = 0; index < 128; index++) {
      const subnet = selectBuildSubnet(null, used);
      expect(
        new Address4(subnet).isInSubnet(new Address4('172.19.0.0/16')),
      ).toBe(true);
      used.push(ipv4Subnet(subnet));
    }
    expect(selectBuildSubnet(null, used)).toBe('172.20.0.0/23');
  });

  test('preserves daemon LAN/VPN routes, default gateways and private DNS addresses', () => {
    const reserved = daemonReservedSubnets(
      [
        { dst: 'default', gateway: '10.44.0.1' },
        { dst: '172.17.0.0/16', prefsrc: '172.17.0.2' },
        { dst: '192.168.65.0/24' },
        { dst: '10.0.0.0/16' },
      ],
      'nameserver 10.1.0.10\nnameserver 8.8.8.8\nnameserver fd00::1\n',
    );
    expect(
      selectBuildSubnet([{ Base: '10.0.0.0/8', Size: 23 }], reserved),
    ).toBe('10.1.2.0/23');
    expect(
      reserved.some((range) => new Address4('10.44.0.1').isInSubnet(range)),
    ).toBe(true);
    expect(
      reserved.some((range) => new Address4('192.168.65.1').isInSubnet(range)),
    ).toBe(true);
  });

  test('does not enumerate a large custom pool before selecting or rejecting it', () => {
    const pools = [{ Base: '10.0.0.0/8', Size: 29 }];
    expect(selectBuildSubnet(pools, [])).toBe('10.0.0.0/29');
    expect(() => selectBuildSubnet(pools, [ipv4Subnet('10.0.0.0/8')])).toThrow(
      'no non-overlapping',
    );
  });

  test('incomplete route or DNS observations cannot authorize an explicit allocation', () => {
    expect(() => daemonReservedSubnets({}, '')).toThrow();
    expect(() => daemonReservedSubnets([{}], '')).toThrow();
    expect(() =>
      daemonReservedSubnets([{ dst: '10.0.0.0/8', gateway: null }], ''),
    ).toThrow();
    expect(() => daemonReservedSubnets([], 'nameserver invalid')).toThrow();
    expect(() => daemonReservedSubnets([], 'nameserver')).toThrow();
  });

  test.each([{ pools: null }, { pools: [] }])(
    'subdivides built-in pools without consuming an entire default /16 (%j)',
    ({ pools }) => {
      const used = ['172.17.0.0/16', '172.18.0.0/16', '172.19.0.0/16'].map(
        ipv4Subnet,
      );
      for (let org = 0; org < 40; org++) {
        const subnet = ipv4Subnet(selectBuildSubnet(pools, used));
        assertBuildSubnet(subnet);
        expect(subnet.subnetMask).toBe(23);
        expect(used.some((range) => subnetsOverlap(subnet, range))).toBe(false);
        used.push(subnet);
      }
    },
  );

  test('honors custom pools and skips occupied children and the whole nested range', () => {
    const pools = [
      { Base: '172.31.0.0/16', Size: 24 },
      { Base: '10.44.0.0/22', Size: 24 },
    ];
    const used = [ipv4Subnet('10.44.0.0/23'), ipv4Subnet('10.44.2.128/25')];
    expect(selectBuildSubnet(pools, used)).toBe('10.44.3.0/24');
  });

  test('pool exhaustion is explicit and does not silently use public or nested space', () => {
    const pools = [
      { Base: '203.0.113.0/24', Size: 24 },
      { Base: '172.31.0.0/16', Size: 24 },
      { Base: '10.0.0.0/23', Size: 23 },
    ];
    expect(() => selectBuildSubnet(pools, [ipv4Subnet('10.0.0.0/23')])).toThrow(
      'no non-overlapping private subnet',
    );
  });

  test('a contended candidate is excluded from the bounded retry', () => {
    const pools = [{ Base: '10.20.0.0/22', Size: 23 }];
    const first = selectBuildSubnet(pools, []);
    const second = selectBuildSubnet(pools, [], new Set([first]));
    expect(second).not.toBe(first);
    expect(subnetsOverlap(new Address4(first), new Address4(second))).toBe(
      false,
    );
  });

  test.each(['172.16.0.0/12', '172.31.0.0/24', '0.0.0.0/0'])(
    'rejects unsafe adopted subnets (%s)',
    (subnet) => {
      expect(() => assertBuildSubnet(ipv4Subnet(subnet))).toThrow();
    },
  );

  test.each([
    '1.2.3.4/24',
    '192.168.1.0/24/7',
    '010.0.0.0/24',
    '1.2.3.4',
    'invalid',
  ])('rejects invalid CIDR metadata (%s)', (subnet) => {
    expect(() => ipv4Subnet(subnet)).toThrow();
  });

  test('validates both address families and tolerates subnet-free built-in networks', () => {
    expect(dockerIpv4Subnets(null)).toEqual([]);
    expect(dockerIpv4Subnets([])).toEqual([]);
    expect(
      dockerIpv4Subnets([
        { Subnet: 'fd00::/64' },
        { Subnet: '192.168.1.0/24' },
      ]).map((subnet) => subnet.address),
    ).toEqual(['192.168.1.0/24']);
    expect(() => dockerIpv4Subnets([{ Subnet: 'not:ipv6' }])).toThrow();
    expect(() => dockerIpv4Subnets([{ Gateway: '10.0.0.1' }])).toThrow();
  });
});
