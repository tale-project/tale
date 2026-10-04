import { expect, test } from 'bun:test';

import {
  assertPrivateLoopback,
  assertSharedNetwork,
  type NetworkReadback,
} from './browser/network';

const zero = '0'.repeat(32);
const route = `${zero} 00 ${zero} 00 ${zero} ffffffff 00000001 00000000 00200200 lo`;
const loopback = `${zero.slice(0, -1)}1 80 ${zero} 00 ${zero} 00000000 00000001 00000000 80200001 lo`;
const valid: NetworkReadback = {
  namespace: 'net:[12345]\n',
  interfaces:
    'Inter-| Receive\n face |bytes\n lo: 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n',
  addresses6: `${zero.slice(0, -1)}1 01 80 10 80 lo\n`,
  routes4:
    'Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\n',
  routes6: `${route}\n${loopback}\n${route}\n`,
  disableIpv6: '0\n',
};

test('private namespace proof accepts only ready loopback and rejected default sentinels', () => {
  expect(() => assertPrivateLoopback(valid)).not.toThrow();
  for (const change of [
    { namespace: 'mnt:[12345]' },
    { disableIpv6: '1' },
    {
      interfaces: valid.interfaces + 'eth0: 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n',
    },
    { addresses6: '' },
    { routes6: '' },
    { addresses6: valid.addresses6.replace('10 80', '10 c0') },
    { addresses6: valid.addresses6.replace('01 80', '01 40') },
    { addresses6: valid.addresses6 + valid.addresses6 },
    {
      routes4:
        valid.routes4 + 'lo 00000000 00000000 0001 0 0 0 00000000 0 0 0\n',
    },
    {
      routes4:
        valid.routes4 + 'eth0 0000007F 00000000 0001 0 0 0 000000FF 0 0 0\n',
    },
    { routes6: route.replace('00200200', '00000001') },
    { routes6: loopback.replace('lo', 'eth0') },
    {
      routes6: loopback.replace(
        `${zero} 00000000`,
        `${zero.slice(0, -1)}2 00000000`,
      ),
    },
  ])
    expect(() => assertPrivateLoopback({ ...valid, ...change })).toThrow();
});

test('both measured containers must share the exact owned none-network namespace', () => {
  const id = 'a'.repeat(64);
  const db = { ...valid, networkMode: 'none' };
  const browser = { ...valid, networkMode: `container:${id}` };
  expect(() => assertSharedNetwork(db, browser, id)).not.toThrow();
  expect(() =>
    assertSharedNetwork({ ...db, networkMode: 'host' }, browser, id),
  ).toThrow();
  expect(() =>
    assertSharedNetwork(
      db,
      { ...browser, networkMode: `container:${'b'.repeat(64)}` },
      id,
    ),
  ).toThrow();
  expect(() =>
    assertSharedNetwork(db, { ...browser, namespace: 'net:[23456]' }, id),
  ).toThrow();
  expect(() => assertSharedNetwork(db, browser, '--other')).toThrow();
});
