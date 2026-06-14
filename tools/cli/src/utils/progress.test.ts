import { describe, expect, test } from 'bun:test';

import {
  formatHeartbeat,
  formatStepLine,
  runStepsInParallel,
  startActivityWatchdog,
} from './progress';

/** Capture logger calls without touching stdout. */
function fakeLogger() {
  const lines: string[] = [];
  return {
    lines,
    step: (m: string) => lines.push(`STEP ${m}`),
    success: (m: string) => lines.push(`OK ${m}`),
    error: (m: string) => lines.push(`ERR ${m}`),
    info: (m: string) => lines.push(`INFO ${m}`),
  };
}

describe('formatStepLine', () => {
  test('success has no suffix', () => {
    expect(formatStepLine(2, 8, 'image:1.0', true)).toBe('[2/8] image:1.0');
  });
  test('failure appends marker', () => {
    expect(formatStepLine(3, 8, 'image:1.0', false)).toBe(
      '[3/8] image:1.0 — failed',
    );
  });
});

describe('formatHeartbeat', () => {
  test('renders label + elapsed seconds', () => {
    expect(formatHeartbeat('pulling images', 30)).toBe(
      '… still working: pulling images (no update for 30s)',
    );
  });
});

describe('runStepsInParallel', () => {
  test('runs all steps and returns results in INPUT order', async () => {
    const log = fakeLogger();
    const order: string[] = [];
    const results = await runStepsInParallel(
      [
        {
          label: 'slow',
          run: async () => {
            await new Promise((r) => setTimeout(r, 30));
            order.push('slow');
            return 'a';
          },
        },
        {
          label: 'fast',
          run: async () => {
            order.push('fast');
            return 'b';
          },
        },
      ],
      { title: 'Pulling images', log },
    );

    // fast finishes before slow → ran concurrently.
    expect(order[0]).toBe('fast');
    // …but results stay in input order.
    expect(results.map((r) => r.label)).toEqual(['slow', 'fast']);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results[0].value).toBe('a');
    expect(log.lines[0]).toBe('STEP Pulling images (2)');
  });

  test('a failing step does not cancel peers and never throws', async () => {
    const log = fakeLogger();
    const results = await runStepsInParallel(
      [
        { label: 'ok-1', run: async () => 1 },
        {
          label: 'boom',
          run: async () => {
            throw new Error('pull failed');
          },
        },
        { label: 'ok-2', run: async () => 2 },
      ],
      { log },
    );

    expect(results.filter((r) => r.ok)).toHaveLength(2);
    const failed = results.find((r) => !r.ok);
    if (!failed) throw new Error('expected a failed step');
    expect(failed.label).toBe('boom');
    expect((failed.error as Error).message).toBe('pull failed');
    expect(log.lines.some((l) => l.includes('boom — failed'))).toBe(true);
  });
});

describe('startActivityWatchdog', () => {
  test('is a no-op under a TTY', () => {
    const log = fakeLogger();
    const wd = startActivityWatchdog('deploy', { isTTY: true, log });
    wd.beat();
    wd.stop();
    expect(log.lines).toHaveLength(0);
  });

  test('emits heartbeats during silence in non-TTY', async () => {
    const log = fakeLogger();
    const wd = startActivityWatchdog('deploy', {
      isTTY: false,
      intervalMs: 20,
      log,
    });
    try {
      await new Promise((r) => setTimeout(r, 75));
    } finally {
      wd.stop();
    }
    expect(log.lines.length).toBeGreaterThanOrEqual(1);
    expect(log.lines[0]).toContain('still working: deploy');
  });

  test('beat() resets the silence timer (no heartbeat while active)', async () => {
    const log = fakeLogger();
    let clock = 0;
    const wd = startActivityWatchdog('deploy', {
      isTTY: false,
      intervalMs: 20,
      log,
      now: () => clock,
    });
    try {
      // Advance the injected clock only a little and keep beating: each tick
      // sees elapsed < interval, so nothing is logged.
      for (let i = 0; i < 3; i++) {
        clock += 5;
        wd.beat();
        await new Promise((r) => setTimeout(r, 20));
      }
    } finally {
      wd.stop();
    }
    expect(log.lines).toHaveLength(0);
  });
});
