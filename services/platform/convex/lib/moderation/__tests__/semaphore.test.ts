import { afterEach, describe, expect, it } from 'vitest';

import {
  acquire,
  inFlightCount,
  queueDepth,
  resetForTesting,
} from '../semaphore';

describe('lib/moderation/semaphore', () => {
  afterEach(() => resetForTesting());

  it('grants immediate access up to the cap', async () => {
    const r1 = await acquire('s1', 2);
    const r2 = await acquire('s1', 2);
    expect(inFlightCount('s1')).toBe(2);
    expect(queueDepth('s1')).toBe(0);
    r1();
    r2();
  });

  it('queues FIFO past the cap and releases cleanly', async () => {
    const releases: Array<() => void> = [];
    releases.push(await acquire('s2', 2));
    releases.push(await acquire('s2', 2));
    expect(inFlightCount('s2')).toBe(2);

    const waiters: Array<Promise<() => void>> = [
      acquire('s2', 2),
      acquire('s2', 2),
    ];
    // Yield once so the queued promises attach.
    await Promise.resolve();
    expect(queueDepth('s2')).toBe(2);

    // Release one slot — first waiter should now hold it.
    releases[0]();
    const first = await waiters[0];
    expect(inFlightCount('s2')).toBe(2);
    expect(queueDepth('s2')).toBe(1);

    releases[1]();
    const second = await waiters[1];
    expect(inFlightCount('s2')).toBe(2);
    expect(queueDepth('s2')).toBe(0);

    first();
    second();
    expect(inFlightCount('s2')).toBe(0);
  });

  it('isolates streams independently', async () => {
    await acquire('a', 1);
    await acquire('b', 1);
    expect(inFlightCount('a')).toBe(1);
    expect(inFlightCount('b')).toBe(1);
  });
});
