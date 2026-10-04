import { describe, expect, test } from 'bun:test';

import { ImageWarmup } from './image-warmup.ts';

describe('runtime image warmup', () => {
  test('runs beside control traffic and coalesces callers until the pull settles', async () => {
    const pulled = Promise.withResolvers<void>();
    let calls = 0;
    const warmup = new ImageWarmup(async () => {
      calls += 1;
      await pulled.promise;
    });
    expect(warmup.pending()).toBe(false);
    const first = warmup.start();
    expect(warmup.pending()).toBe(true);
    expect(warmup.start()).toBe(first);
    await Promise.resolve();
    expect(calls).toBe(1);
    // A control request can finish before the image does.
    expect(await Promise.resolve('control ready')).toBe('control ready');
    expect(warmup.pending()).toBe(true);
    pulled.resolve();
    await first;
    expect(warmup.pending()).toBe(false);
  });

  test('a failed optional warmup settles without leaving creates blocked', async () => {
    const warmup = new ImageWarmup(async () => {
      throw new Error('registry unavailable');
    });
    await warmup.start();
    expect(warmup.pending()).toBe(false);
  });
});
