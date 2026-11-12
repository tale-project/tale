import { describe, expect, test } from 'bun:test';

import type { Healthcheck } from '../compile/translate';
import { IncusHealth, probeArgv } from './health';
import { HealthTracker } from './health-tracker';
import { seedStackInstance, verbsFixture } from './verbs-fixture';

const CHECK: Healthcheck = {
  test: ['CMD', 'true'],
  intervalMs: 10_000,
  timeoutMs: 5_000,
  retries: 3,
  startPeriodMs: 0,
};

describe("Docker's health state machine", () => {
  test('starts starting; one pass is healthy; retries failures in a row are unhealthy', () => {
    const tracker = new HealthTracker(CHECK, 0);
    expect(tracker.current).toBe('starting');
    expect(tracker.record(false, 1_000)).toBe('starting');
    expect(tracker.record(true, 11_000)).toBe('healthy');
    expect(tracker.record(false, 21_000)).toBe('healthy');
    expect(tracker.record(false, 31_000)).toBe('healthy');
    expect(tracker.failingStreak).toBe(2);
    expect(tracker.record(false, 41_000)).toBe('unhealthy');
    // One pass heals it and resets the streak.
    expect(tracker.record(true, 51_000)).toBe('healthy');
    expect(tracker.failingStreak).toBe(0);
  });

  test('a never-passing instance turns unhealthy after retries failures', () => {
    const tracker = new HealthTracker(CHECK, 0);
    tracker.record(false, 1);
    tracker.record(false, 2);
    expect(tracker.record(false, 3)).toBe('unhealthy');
  });

  test('failures inside the start period do not count until the first pass', () => {
    const tracker = new HealthTracker({ ...CHECK, startPeriodMs: 60_000 }, 0);
    for (const at of [5_000, 10_000, 15_000, 20_000])
      expect(tracker.record(false, at)).toBe('starting');
    expect(tracker.failingStreak).toBe(0);
    expect(tracker.record(true, 25_000)).toBe('healthy');
    // After a pass, failures count even inside the start period.
    tracker.record(false, 30_000);
    tracker.record(false, 35_000);
    expect(tracker.record(false, 40_000)).toBe('unhealthy');
    // Past the start period, a fresh tracker counts at once.
    const late = new HealthTracker({ ...CHECK, startPeriodMs: 60_000 }, 0);
    late.record(false, 61_000);
    late.record(false, 62_000);
    expect(late.record(false, 63_000)).toBe('unhealthy');
  });

  test('a probe is due at once, then per interval, per start interval while starting', () => {
    const tracker = new HealthTracker({ ...CHECK, startPeriodMs: 30_000 }, 0);
    expect(tracker.due(0)).toBe(true);
    tracker.record(false, 0);
    expect(tracker.due(4_999)).toBe(false);
    expect(tracker.due(5_000)).toBe(true);
    tracker.record(true, 40_000);
    expect(tracker.due(49_999)).toBe(false);
    expect(tracker.due(50_000)).toBe(true);
  });
});

describe('health on Incus, by exec probe', () => {
  test('CMD runs its argv and CMD-SHELL runs sh -c, as Docker does', () => {
    expect(probeArgv(['CMD', 'pg_isready', '-q'])).toEqual([
      'pg_isready',
      '-q',
    ]);
    expect(probeArgv(['CMD-SHELL', 'curl -f localhost || exit 1'])).toEqual([
      '/bin/sh',
      '-c',
      'curl -f localhost || exit 1',
    ]);
    expect(() => probeArgv(['NONE'])).toThrow('Not a healthcheck test');
  });

  test('probes when due, judges like Docker, and starts over on a restart', async () => {
    const fixture = verbsFixture();
    try {
      const api = seedStackInstance(fixture.fake, 'api');
      api.startedAt = '2026-11-13T10:00:00.000Z';
      seedStackInstance(fixture.fake, 'worker');
      seedStackInstance(fixture.fake, 'crashed', { status: 'Stopped' });
      seedStackInstance(fixture.fake, 'stopped', {
        status: 'Stopped',
        config: { 'user.tale.want': 'stopped' },
      });
      let now = Date.parse('2026-11-13T10:00:01.000Z');
      let exitCode = 1;
      fixture.fake.exec = () => exitCode;
      const health = new IncusHealth(
        fixture.context,
        (name) =>
          name === 'worker'
            ? { disabled: true }
            : name === 'api'
              ? { ...CHECK, test: ['CMD-SHELL', 'probe'] }
              : undefined,
        () => now,
      );
      expect(await health.health('api')).toBe('starting');
      const probe = fixture.fake.execs.at(-1);
      expect(probe?.command).toEqual(['/bin/sh', '-c', 'probe']);
      expect(probe?.mode).toBe('code');
      expect(probe?.timeoutSeconds).toBe(5);
      // Not due yet: no probe, the same answer.
      exitCode = 0;
      now += 1_000;
      expect(await health.health('api')).toBe('starting');
      expect(fixture.fake.execs).toHaveLength(1);
      now += 10_000;
      expect(await health.health('api')).toBe('healthy');
      // A restart Incus made (a later started_at) starts a fresh tracker.
      api.startedAt = '2026-11-13T10:05:00.000Z';
      exitCode = 1;
      expect(await health.health('api')).toBe('starting');
      expect(await health.health('worker')).toBe('none');
      expect(await health.health('crashed')).toBe('unhealthy');
      expect(await health.health('stopped')).toBe('none');
      expect(await health.health('gone')).toBe('none');
      expect(fixture.fake.execs).toHaveLength(3);
    } finally {
      fixture.remove();
    }
  });
});
