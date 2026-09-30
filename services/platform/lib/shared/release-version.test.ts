import { describe, expect, it } from 'vitest';

import { isReleaseVersion } from './release-version';

/** The shape `release.yml` stamps into a release image's `TALE_VERSION`,
 * and nothing else: every other label a build carries is not a release. */
describe('isReleaseVersion', () => {
  it('accepts a release number and a prerelease, as the release workflow builds them', () => {
    for (const version of [
      '0.5.64',
      '10.20.30',
      '0.6.0-rc.1',
      '1.0.0-beta-2',
    ]) {
      expect(isReleaseVersion(version)).toBe(true);
    }
  });

  it('refuses the labels of development, unreleased and malformed builds', () => {
    const sha = 'ebf4546fb1455a236c1046f3d73ef78c2e1d0109';
    for (const label of [
      '',
      'dev',
      'latest',
      `candidate-sha-${sha}`,
      `pr-3969-sha-${sha}`,
      `sha-${sha}`,
      'v0.5.64',
      '0.5',
      '0.5.64.1',
      '0.5.64-',
      '0.5.64+build.7',
      '0.5.64-rc_1',
      ' 0.5.64',
      '0.5.64\n',
      '0.5.64 0.5.65',
      '０.５.６４',
    ]) {
      expect(isReleaseVersion(label)).toBe(false);
    }
  });
});
