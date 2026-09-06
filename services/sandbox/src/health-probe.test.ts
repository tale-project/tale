// REGRESSION: probeHealth cached only AFTER the backend call resolved, so
// while one probe was slow (a wedged daemon) every concurrent /health hit
// spawned its own `docker version` child. Concurrent probes now share one
// in-flight call; the TTL cache still serves the result afterwards.

import { describe, expect, test } from 'bun:test';

import { makeHealthProbe } from './health-probe.ts';

describe('makeHealthProbe', () => {
  test('concurrent callers share one in-flight probe; the TTL cache serves later hits', async () => {
    let calls = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let clock = 1_000;
    const probe = makeHealthProbe(
      async () => {
        calls += 1;
        await gate;
        return { ok: true, detail: '29.0' };
      },
      60_000,
      () => clock,
    );
    const a = probe();
    const b = probe();
    const c = probe();
    expect(calls).toBe(1);
    release();
    expect(await Promise.all([a, b, c])).toEqual([
      { ok: true, detail: '29.0' },
      { ok: true, detail: '29.0' },
      { ok: true, detail: '29.0' },
    ]);
    // Within the TTL: served from the cache, no new probe.
    clock += 30_000;
    expect(await probe()).toEqual({ ok: true, detail: '29.0' });
    expect(calls).toBe(1);
    // Past the TTL: probed again.
    clock += 60_000;
    expect(await probe()).toEqual({ ok: true, detail: '29.0' });
    expect(calls).toBe(2);
  });

  test('an unhealthy answer is cached for the TTL too (no re-probe storm)', async () => {
    let calls = 0;
    let clock = 0;
    const probe = makeHealthProbe(
      async () => {
        calls += 1;
        return { ok: false, error: 'Cannot connect to the Docker daemon' };
      },
      60_000,
      () => clock,
    );
    expect(await probe()).toEqual({
      ok: false,
      error: 'Cannot connect to the Docker daemon',
    });
    clock += 10_000;
    await probe();
    expect(calls).toBe(1);
  });

  test('a rejecting probe rejects every sharer and releases the in-flight slot', async () => {
    let calls = 0;
    const probe = makeHealthProbe(async () => {
      calls += 1;
      throw new Error('spawn failed');
    }, 60_000);
    const results = await Promise.allSettled([probe(), probe()]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(calls).toBe(1);
    await Promise.allSettled([probe()]);
    expect(calls).toBe(2);
  });
});
