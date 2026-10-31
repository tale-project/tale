import { describe, expect, it } from 'vitest';

import {
  dockerEngineMajor,
  isDockerEngineBelowFloor,
  MIN_DOCKER_ENGINE_MAJOR,
  ZSTD_DOCKER_ENGINE_MAJOR,
} from './docker-engine';

describe('the Docker Engine floor', () => {
  it('is Engine 24, which also pulls the zstd-compressed images Tale publishes', () => {
    expect(MIN_DOCKER_ENGINE_MAJOR).toBe(24);
    expect(ZSTD_DOCKER_ENGINE_MAJOR).toBe(23);
    expect(ZSTD_DOCKER_ENGINE_MAJOR).toBeLessThanOrEqual(
      MIN_DOCKER_ENGINE_MAJOR,
    );
  });
});

describe('dockerEngineMajor', () => {
  it('reads the major of releases, candidates and distribution builds', () => {
    expect(dockerEngineMajor('20.10.24')).toBe(20);
    expect(dockerEngineMajor('v24.0.7')).toBe(24);
    expect(dockerEngineMajor('17.03.2-ce')).toBe(17);
    expect(dockerEngineMajor('24.0.0-rc.1')).toBe(24);
    expect(dockerEngineMajor('26.1.5+dfsg1')).toBe(26);
    expect(dockerEngineMajor('1.13.1')).toBe(1);
  });

  it('reads none from a version that does not start with one', () => {
    for (const version of ['', 'dev', '24', 'Docker 24.0.7', ' 24.0.7']) {
      expect(dockerEngineMajor(version)).toBeNull();
    }
  });
});

describe('isDockerEngineBelowFloor', () => {
  it('judges every Docker Engine numbering older than the floor', () => {
    // 1.x, the year.month releases, and 23.x, which pulls zstd but is
    // older than the supported floor.
    for (const version of [
      '1.13.1',
      '17.03.2-ce',
      '18.09.7',
      '19.03.15',
      '20.10.24',
      '23.0.6',
    ]) {
      expect(isDockerEngineBelowFloor(version)).toBe(true);
    }
  });

  it('passes the floor and every later engine', () => {
    for (const version of [
      `${MIN_DOCKER_ENGINE_MAJOR}.0.0`,
      '24.0.0-rc.1',
      '26.1.5+dfsg1',
      '28.3.2',
      '29.6.1',
    ]) {
      expect(isDockerEngineBelowFloor(version)).toBe(false);
    }
  });

  it("never judges another engine's own release", () => {
    // A Podman socket reports Podman's version where Docker reports the
    // engine's: no Docker Engine was ever numbered 2 to 16, 21 or 22.
    for (const version of ['2.2.1', '4.9.3', '5.2.0', '16.0.0', '22.1.0']) {
      expect(isDockerEngineBelowFloor(version)).toBe(false);
    }
  });

  it('never judges a missing or unreadable version', () => {
    for (const version of [null, undefined, '', 'dev', 'unknown']) {
      expect(isDockerEngineBelowFloor(version)).toBe(false);
    }
  });
});
