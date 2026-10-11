// Sizes as the spawner writes them and Incus reads them.

import { describe, expect, test } from 'bun:test';

import { incusSizeBytes, toIncusSize } from './incus-units.ts';

describe('toIncusSize', () => {
  test.each([
    ['4g', '4GiB'],
    ['512m', '512MiB'],
    ['64k', '64KiB'],
    ['1024', '1024B'],
    ['10G', '10GiB'],
    ['10GiB', '10GiB'],
    ['500MB', '500MB'],
    [' 8g ', '8GiB'],
  ])('reads %j as %s', (input, expected) => {
    expect(toIncusSize(input)).toBe(expected);
  });

  test.each(['', '0', '0g', '-1g', '1.5g', '10x', 'g', '10 GiB', '10gb'])(
    'refuses %j',
    (input) => {
      expect(toIncusSize(input)).toBeUndefined();
    },
  );
});

describe('incusSizeBytes', () => {
  test('counts a Docker g as a gibibyte and Incus’s GB as a billion', () => {
    expect(incusSizeBytes('4g')).toBe(4 * 1024 ** 3);
    expect(incusSizeBytes('4GiB')).toBe(4 * 1024 ** 3);
    expect(incusSizeBytes('4GB')).toBe(4_000_000_000);
    expect(incusSizeBytes('512MiB')).toBe(512 * 1024 ** 2);
    expect(incusSizeBytes('2TiB')).toBe(2 * 1024 ** 4);
    expect(incusSizeBytes('7')).toBe(7);
  });

  test.each(['', '50%', '0', 'lots', '1PB'])('has no bytes for %j', (input) => {
    expect(incusSizeBytes(input)).toBeUndefined();
  });
});
