import { describe, expect, it } from 'vitest';

import { settle, track } from './promises.ts';

describe('settle', () => {
  it('lets what can run without a timer run', async () => {
    const order: string[] = [];
    void Promise.resolve()
      .then(() => order.push('a'))
      .then(() => order.push('b'));
    await settle();
    expect(order).toEqual(['a', 'b']);
  });

  it('gives a chain of promises as many turns as it is asked for', async () => {
    let turns = 0;
    const chain = async (): Promise<void> => {
      for (let step = 0; step < 3; step++) {
        await new Promise<void>((resolve) => {
          setImmediate(resolve);
        });
        turns += 1;
      }
    };
    void chain();
    await settle(1);
    expect(turns).toBeLessThan(3);
    await settle(4);
    expect(turns).toBe(3);
  });
});

describe('track', () => {
  it('says whether a promise has ended, whichever way', async () => {
    const pending = Promise.withResolvers<void>();
    const watched = track(pending.promise);
    expect(watched.settled).toBe(false);
    pending.resolve();
    await settle();
    expect(watched.settled).toBe(true);

    const failing = Promise.withResolvers<void>();
    const failed = track(failing.promise);
    failing.reject(new Error('no'));
    await settle();
    expect(failed.settled).toBe(true);
  });
});
