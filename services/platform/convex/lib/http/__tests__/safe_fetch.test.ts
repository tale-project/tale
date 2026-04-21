import { describe, expect, it } from 'vitest';

import { isPrivateIp } from '../safe_fetch';

describe('lib/http/safe_fetch.isPrivateIp', () => {
  it.each([
    'localhost',
    '127.0.0.1',
    '127.250.5.1',
    '10.0.0.5',
    '172.16.3.7',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '[::1]',
    'something.local',
    'fe80::abcd',
    'fc00::1',
    'fd12::5',
  ])('rejects private / loopback / link-local: %s', (host) => {
    expect(isPrivateIp(host)).toBe(true);
  });

  it.each([
    'api.openai.com',
    'example.com',
    '1.1.1.1',
    '8.8.8.8',
    '172.15.0.1', // just outside 172.16/12
    '172.32.0.1', // just outside 172.16/12 upper bound
    '11.0.0.1', // just outside 10/8
  ])('accepts public host / address: %s', (host) => {
    expect(isPrivateIp(host)).toBe(false);
  });
});
