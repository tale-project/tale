// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { laneBarrier } from './lane-barrier.ts';

/** The barrier W25 holds its two binding loops at (#4540): a lane must
 * force the interleaving it reports, or fail — never pass without it. */
describe('laneBarrier — every body arrives before any goes on, or none does', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('releases the bodies together, and only once all have arrived', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const barrier = laneBarrier(2, 1_000, () => order.push('released'));
    const first = barrier.arrive().then(() => order.push('first goes on'));
    await vi.advanceTimersByTimeAsync(999);
    order.push('second arrives');
    const second = barrier.arrive().then(() => order.push('second goes on'));
    await Promise.all([first, second]);
    expect(barrier.met()).toBe(true);
    expect(order).toEqual([
      'second arrives',
      'released',
      'first goes on',
      'second goes on',
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('breaks for good when a body is late: the early body is refused, the late one too, and it is never met', async () => {
    vi.useFakeTimers();
    const barrier = laneBarrier(2, 1_000);
    const early = barrier.arrive().then(
      () => 'went on alone',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await early).toBeInstanceOf(Error);
    await expect(barrier.arrive()).rejects.toThrow(/broken/);
    expect(barrier.met()).toBe(false);
  });

  it('refuses an arrival once it has released', async () => {
    vi.useFakeTimers();
    const barrier = laneBarrier(1, 1_000);
    await barrier.arrive();
    await expect(barrier.arrive()).rejects.toThrow(/met: arrival refused/);
    expect(barrier.met()).toBe(true);
  });

  it('cleans up: dispose stops the timer and breaks a barrier still open', async () => {
    vi.useFakeTimers();
    const barrier = laneBarrier(2, 1_000);
    barrier.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await expect(barrier.arrive()).rejects.toThrow(/broken/);
    expect(barrier.met()).toBe(false);
  });
});
