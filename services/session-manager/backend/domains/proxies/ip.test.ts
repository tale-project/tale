import { describe, expect, it } from 'vitest';

import { isIPv4, normalizeIp, parseIPv6 } from './ip.ts';

describe('isIPv4', () => {
  it.each(['0.0.0.0', '1.2.3.4', '255.255.255.255', '10.0.0.1', '127.0.0.1'])(
    'accepts %j',
    (text) => {
      expect(isIPv4(text)).toBe(true);
    },
  );

  it.each([
    '',
    '1.2.3',
    '1.2.3.4.5',
    '256.1.1.1',
    '01.2.3.4',
    '1.2.3.04',
    '1.2.3.',
    '.1.2.3',
    '1..2.3',
    '1.2.3.4 ',
    ' 1.2.3.4',
    '1.2.3.4/24',
    '0x7f.0.0.1',
    '127.1',
    '１.２.３.４',
    '1.2.3.-4',
  ])('refuses %j', (text) => {
    expect(isIPv4(text)).toBe(false);
  });
});

// The expected spellings are the compressed form of RFC 5952.
describe('parseIPv6', () => {
  it.each<[string, string | null]>([
    ['::', '::'],
    ['::1', '::1'],
    ['1::', '1::'],
    ['1::2', '1::2'],
    ['0:0:0:0:0:0:0:0', '::'],
    ['0:0:0:0:0:0:0:1', '::1'],
    ['2001:DB8:0:0::1', '2001:db8::1'],
    ['2001:0db8:0000:0000:0000:ff00:0042:8329', '2001:db8::ff00:42:8329'],
    ['1:0:0:2:0:0:0:3', '1:0:0:2::3'],
    ['1:0:2:3:4:5:6:7', '1:0:2:3:4:5:6:7'],
    ['1:2:3:4:5:6:7::', '1:2:3:4:5:6:7:0'],
    ['::2:3:4:5:6:7:8', '0:2:3:4:5:6:7:8'],
    ['1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7:8'],
    ['::1.2.3.4', '::102:304'],
    ['::ffff:1.2.3.4', '::ffff:102:304'],
    ['64:ff9b::192.0.2.33', '64:ff9b::c000:221'],
    ['fe80::1%eth0', 'fe80::1'],
    ['ff02::1', 'ff02::1'],
    ['FF02::1', 'ff02::1'],
    ['0:0:1:0:0:1:0:0', '::1:0:0:1:0:0'],
    ['1:0:0:1:0:0:1:0', '1::1:0:0:1:0'],
    ['0:1:0:1:0:1:0:1', '0:1:0:1:0:1:0:1'],
    // too many groups, a second "::", a stray colon, a bad group, a bad tail
    ['1:2:3:4:5:6:7:8:9', null],
    ['1:2:3:4:5:6:7:8::', null],
    ['1.2.3.4', null],
    [':::', null],
    ['1::2::3', null],
    [':1:2:3:4:5:6:7', null],
    ['1:2:3:4:5:6:7:', null],
    ['fe80::1%', null],
    ['fe80::1%a%b', null],
    ['fe80::1/64', null],
    ['g::1', null],
    ['12345::1', null],
    ['1:2:3', null],
    ['', null],
    [':', null],
    ['::ffff:256.1.1.1', null],
    ['::01.2.3.4', null],
  ])('reads %j as %j', (text, expected) => {
    expect(parseIPv6(text)).toBe(expected);
  });
});

describe('normalizeIp', () => {
  it('gives an address one spelling', () => {
    expect(normalizeIp('203.0.113.9')).toBe('203.0.113.9');
    expect(normalizeIp('2001:DB8:0:0::1')).toBe('2001:db8::1');
  });

  it.each(['', 'nope', '203.0.113', '<html>not an ip</html>', '1.2.3.4\n'])(
    'knows %j is no address',
    (text) => {
      expect(normalizeIp(text)).toBeNull();
    },
  );
});
