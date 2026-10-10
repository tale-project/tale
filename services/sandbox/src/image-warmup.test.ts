import { describe, expect, test } from 'bun:test';

import { ImageWarmup } from './image-warmup.ts';

const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

describe('runtime image warmup', () => {
  test('runs beside control traffic and coalesces callers until the pull settles', async () => {
    const pulled = Promise.withResolvers<void>();
    let calls = 0;
    const warmup = new ImageWarmup(async () => {
      calls += 1;
      await pulled.promise;
    });
    expect(warmup.pending()).toBe(false);
    expect(warmup.status().state).toBe('unchecked');
    const first = warmup.start();
    expect(warmup.pending()).toBe(true);
    expect(warmup.status().state).toBe('pulling');
    expect(warmup.start()).toBe(first);
    expect(warmup.restart('No such image')).toBe(first);
    await Promise.resolve();
    expect(calls).toBe(1);
    // A control request can finish before the image does.
    expect(await Promise.resolve('control ready')).toBe('control ready');
    expect(warmup.pending()).toBe(true);
    const refusal = warmup.refusal();
    expect(refusal?.status).toBe(429);
    expect(refusal?.headers.get('retry-after')).toBe('5');
    expect(await refusal?.json()).toMatchObject({ error: 'runtime_image' });
    pulled.resolve();
    await first;
    expect(warmup.pending()).toBe(false);
    expect(warmup.refusal()).toBeNull();
    expect(warmup.status()).toEqual({
      state: 'ready',
      lastError: null,
      nextAttemptAtMs: null,
    });
  });

  test('a failed pull keeps creates waiting and is tried again with backoff until the image is back', async () => {
    let calls = 0;
    let now = 1_000_000;
    const warmup = new ImageWarmup(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error(`registry unavailable (${calls})`);
      },
      { delaysMs: [20, 40], now: () => now },
    );
    await warmup.start();
    // The image is still absent: every create would fail, so they wait.
    expect(warmup.pending()).toBe(true);
    expect(warmup.status()).toEqual({
      state: 'missing',
      lastError: 'registry unavailable (1)',
      nextAttemptAtMs: now + 20,
    });
    const refusal = warmup.refusal();
    expect(refusal?.status).toBe(429);
    expect(refusal?.headers.get('retry-after')).toBe('5');
    expect(await refusal?.json()).toMatchObject({
      error: 'runtime_image',
      detail: 'registry unavailable (1)',
    });
    // A create racing the scheduled retry does not pull ahead of it.
    await warmup.restart('No such image');
    expect(calls).toBe(1);
    now += 20;
    await tick(30);
    expect(calls).toBe(2);
    expect(warmup.status()).toMatchObject({
      state: 'missing',
      lastError: 'registry unavailable (2)',
      nextAttemptAtMs: now + 40,
    });
    await tick(60);
    expect(calls).toBe(3);
    expect(warmup.status().state).toBe('ready');
    expect(warmup.pending()).toBe(false);
    warmup.stop();
  });

  test('the wait a missing image asks for follows the next pull, between 5 s and a minute', async () => {
    let now = 0;
    const warmup = new ImageWarmup(
      async () => {
        throw new Error('pull access denied');
      },
      { delaysMs: [600_000], now: () => now },
    );
    await warmup.start();
    expect(warmup.refusal()?.headers.get('retry-after')).toBe('60');
    now += 590_000;
    expect(warmup.refusal()?.headers.get('retry-after')).toBe('10');
    now += 9_000;
    expect(warmup.refusal()?.headers.get('retry-after')).toBe('5');
    warmup.stop();
  });

  test('a create that finds a ready image gone pulls it again', async () => {
    let calls = 0;
    const pulled = Promise.withResolvers<void>();
    const warmup = new ImageWarmup(async () => {
      calls += 1;
      if (calls === 2) await pulled.promise;
    });
    await warmup.start();
    expect(warmup.status().state).toBe('ready');
    const again = warmup.restart('No such image: runtime:test');
    expect(warmup.pending()).toBe(true);
    expect(warmup.status().state).toBe('pulling');
    pulled.resolve();
    await again;
    expect(calls).toBe(2);
    expect(warmup.pending()).toBe(false);
  });
});
