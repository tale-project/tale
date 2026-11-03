import { describe, expect, it } from 'vitest';

import { proxy } from '@/tests/utils/fixtures';

import {
  addressOf,
  addressPrefixOf,
  hostPortOf,
  hostPortOfDisplay,
} from './address';

describe('hostPortOf', () => {
  it('joins host and port', () => {
    expect(hostPortOf(proxy({ host: '198.51.100.4', port: 8080 }))).toBe(
      '198.51.100.4:8080',
    );
  });

  it('writes an IPv6 host in brackets, as it is typed', () => {
    expect(hostPortOf(proxy({ host: '2001:db8::1', port: 3128 }))).toBe(
      '[2001:db8::1]:3128',
    );
  });
});

describe('addressOf', () => {
  it('is scheme, host and port for a proxy without a login', () => {
    expect(addressPrefixOf(proxy({ scheme: 'socks5' }))).toBe('socks5://');
    expect(addressOf(proxy({ scheme: 'socks5' }))).toBe(
      'socks5://198.51.100.4:8080',
    );
  });

  it('puts the user name in front of the host, and never a password', () => {
    const withLogin = proxy({ username: 'ada', hasPassword: true });
    expect(addressPrefixOf(withLogin)).toBe('http://ada@');
    expect(addressOf(withLogin)).toBe('http://ada@198.51.100.4:8080');
    expect(addressOf(withLogin)).not.toContain(':pass');
  });
});

describe('hostPortOfDisplay', () => {
  it.each([
    ['http://198.51.100.4:8080', '198.51.100.4:8080'],
    ['socks5://ada@gate.example.com:7000', 'gate.example.com:7000'],
    ['https://[2001:db8::1]:3128', '[2001:db8::1]:3128'],
    ['198.51.100.4:8080', '198.51.100.4:8080'],
  ])('reads host and port out of %s', (display, expected) => {
    expect(hostPortOfDisplay(display)).toBe(expected);
  });

  it('keeps what follows the last @, as a user name may hold one', () => {
    expect(hostPortOfDisplay('http://ada@corp@198.51.100.4:8080')).toBe(
      '198.51.100.4:8080',
    );
  });
});
