import { describe, expect, it } from 'vitest';

import {
  buildOrderKey,
  compareSemver,
  normalizeSemver,
  parseSemver,
} from './semver';

describe('parseSemver', () => {
  it('parses plain and v-prefixed versions', () => {
    expect(parseSemver('0.2.85')).toEqual({ major: 0, minor: 2, patch: 85 });
    expect(parseSemver('v1.20.3')).toEqual({ major: 1, minor: 20, patch: 3 });
  });
  it('rejects non-three-segment versions', () => {
    expect(() => parseSemver('0.2')).toThrow();
    expect(() => parseSemver('0.2.85-rc1')).toThrow();
    expect(() => parseSemver('latest')).toThrow();
  });
});

describe('normalizeSemver', () => {
  it('strips the v prefix', () => {
    expect(normalizeSemver('v0.2.85')).toBe('0.2.85');
    expect(normalizeSemver('0.2.85')).toBe('0.2.85');
  });
});

describe('compareSemver', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareSemver('0.2.84', '0.2.85')).toBeLessThan(0);
    expect(compareSemver('0.3.0', '0.2.99')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareSemver('0.2.85', '0.2.85')).toBe(0);
  });
});

describe('buildOrderKey', () => {
  it('produces lexicographically-sortable keys', () => {
    const keys = [
      buildOrderKey('0.2.85', 3),
      buildOrderKey('0.2.85', 1),
      buildOrderKey('0.2.14', 1),
      buildOrderKey('0.10.0', 1),
      buildOrderKey('0.2.85', 2),
    ];
    const sorted = [...keys].sort((a, b) => a.localeCompare(b));
    expect(sorted).toEqual([
      buildOrderKey('0.2.14', 1),
      buildOrderKey('0.2.85', 1),
      buildOrderKey('0.2.85', 2),
      buildOrderKey('0.2.85', 3),
      buildOrderKey('0.10.0', 1),
    ]);
  });

  it('zero-pads so 0.10.0 sorts after 0.2.x (numeric, not string, order)', () => {
    expect(
      buildOrderKey('0.2.85', 1).localeCompare(buildOrderKey('0.10.0', 1)),
    ).toBeLessThan(0);
  });

  it('rejects negative / non-integer ids', () => {
    expect(() => buildOrderKey('0.2.85', -1)).toThrow();
    expect(() => buildOrderKey('0.2.85', 1.5)).toThrow();
  });
});
