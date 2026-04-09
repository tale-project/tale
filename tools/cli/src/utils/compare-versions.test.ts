import { describe, expect, test } from 'bun:test';

import { compareVersions, extractVersion } from './compare-versions';

describe('extractVersion', () => {
  test('extracts version from plain semver', () => {
    expect(extractVersion('0.2.8')).toBe('0.2.8');
  });

  test('extracts version from v-prefixed tag', () => {
    expect(extractVersion('v0.2.8')).toBe('0.2.8');
  });

  test('extracts version from scoped tag with slash', () => {
    expect(extractVersion('cli/v0.2.8')).toBe('0.2.8');
  });

  test('extracts version from scoped tag without v prefix', () => {
    expect(extractVersion('cli/0.2.8')).toBe('0.2.8');
  });

  test('extracts version from monorepo-style tag', () => {
    expect(extractVersion('@tale/cli@0.2.8')).toBe('0.2.8');
  });

  test('extracts version with prerelease suffix', () => {
    expect(extractVersion('v1.0.0-rc1')).toBe('1.0.0-rc1');
  });

  test('extracts version with scoped prerelease tag', () => {
    expect(extractVersion('cli/v1.0.0-rc16')).toBe('1.0.0-rc16');
  });

  test('extracts version with dotted prerelease', () => {
    expect(extractVersion('v2.0.0-beta.3')).toBe('2.0.0-beta.3');
  });

  test('returns null for garbage input', () => {
    expect(extractVersion('not-a-version')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(extractVersion('')).toBeNull();
  });

  test('returns null for partial version', () => {
    expect(extractVersion('v1.2')).toBeNull();
  });
});

describe('compareVersions', () => {
  test('detects newer patch version', () => {
    expect(compareVersions('0.2.8', '0.2.7')).toBeGreaterThan(0);
  });

  test('detects newer minor version', () => {
    expect(compareVersions('0.3.0', '0.2.7')).toBeGreaterThan(0);
  });

  test('detects newer major version', () => {
    expect(compareVersions('1.0.0', '0.2.7')).toBeGreaterThan(0);
  });

  test('returns zero for equal versions', () => {
    expect(compareVersions('0.2.7', '0.2.7')).toBe(0);
  });

  test('detects older version', () => {
    expect(compareVersions('0.2.6', '0.2.7')).toBeLessThan(0);
  });

  test('handles v-prefixed versions', () => {
    expect(compareVersions('v0.2.8', 'v0.2.7')).toBeGreaterThan(0);
  });

  test('handles mixed v-prefix', () => {
    expect(compareVersions('v0.2.8', '0.2.7')).toBeGreaterThan(0);
  });

  test('handles scoped tag against plain version', () => {
    expect(compareVersions('cli/v0.2.8', '0.2.7')).toBeGreaterThan(0);
  });

  test('handles monorepo-style tag', () => {
    expect(compareVersions('@tale/cli@0.3.0', '0.2.7')).toBeGreaterThan(0);
  });

  test('release beats prerelease at same base version', () => {
    expect(compareVersions('1.0.0', '1.0.0-rc1')).toBeGreaterThan(0);
  });

  test('prerelease loses to release at same base version', () => {
    expect(compareVersions('1.0.0-rc1', '1.0.0')).toBeLessThan(0);
  });

  test('higher prerelease number wins', () => {
    expect(compareVersions('1.0.0-rc16', '1.0.0-rc2')).toBeGreaterThan(0);
  });

  test('handles large version numbers', () => {
    expect(compareVersions('0.1.88', '0.1.9')).toBeGreaterThan(0);
  });

  test('throws on invalid version string', () => {
    expect(() => compareVersions('not-a-version', '0.2.7')).toThrow(
      /Cannot compare versions/,
    );
  });

  test('throws on empty string', () => {
    expect(() => compareVersions('', '0.2.7')).toThrow(
      /Cannot compare versions/,
    );
  });
});
