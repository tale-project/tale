import type { networkInterfaces } from 'node:os';

import { describe, expect, it } from 'vitest';

import { relayListenAddress } from './listener.ts';

type Interfaces = ReturnType<typeof networkInterfaces>;

const iface = (address: string, family: 'IPv4' | 'IPv6' = 'IPv4') => ({
  address,
  netmask: '255.255.0.0',
  family,
  mac: '02:42:ac:11:00:02',
  internal: address === '127.0.0.1',
  cidr: `${address}/16`,
  scopeid: 0,
});

/** A backend container on the application network and the sandbox one. */
const CONTAINER = {
  lo: [iface('127.0.0.1')],
  eth0: [iface('172.18.0.5')],
  eth1: [iface('172.30.4.9'), iface('fe80::1', 'IPv6')],
} as unknown as Interfaces;

describe('where the relay listens', () => {
  it('binds the container’s address in the sandbox network alone [RELAY-R2]', () => {
    expect(
      relayListenAddress(
        { SANDBOX_NETWORK_SUBNET: '172.30.0.0/16' },
        CONTAINER,
      ),
    ).toEqual({
      host: '172.30.4.9',
      reach: 'the sandbox network 172.30.0.0/16 alone',
    });
  });

  it('refuses to start where the container has no address in the sandbox network [RELAY-R2]', () => {
    expect(
      relayListenAddress({ SANDBOX_NETWORK_SUBNET: '10.99.0.0/24' }, CONTAINER),
    ).toEqual({
      error:
        'this container has no address in the sandbox network 10.99.0.0/24, so no session could reach the model relay',
    });
    expect(
      relayListenAddress({ SANDBOX_NETWORK_SUBNET: 'fd00::/8' }, CONTAINER),
    ).toEqual({
      error: 'SANDBOX_NETWORK_SUBNET is not an IPv4 CIDR: fd00::/8',
    });
  });

  it('takes an address an operator names over the sandbox network', () => {
    expect(
      relayListenAddress(
        {
          SANDBOX_RELAY_LISTEN_HOST: '0.0.0.0',
          SANDBOX_NETWORK_SUBNET: '172.30.0.0/16',
        },
        CONTAINER,
      ),
    ).toEqual({ host: '0.0.0.0', reach: 'the address 0.0.0.0' });
  });

  it('listens beside the API where no sandbox network is named', () => {
    expect(relayListenAddress({}, CONTAINER)).toEqual({
      host: undefined,
      reach: 'every network this process is on',
    });
    expect(
      relayListenAddress({ BACKEND_LISTEN_HOST: '127.0.0.1' }, CONTAINER),
    ).toEqual({
      host: '127.0.0.1',
      reach: 'the address 127.0.0.1',
    });
  });
});
