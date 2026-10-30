// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOutageWatch, type OutageHooks } from './outage-watch.ts';

/** Hooks that write down what they were told, in order. */
function recorded(): { calls: string[]; hooks: OutageHooks } {
  const calls: string[] = [];
  return {
    calls,
    hooks: {
      began: (error) => calls.push(`began ${(error as Error).message}`),
      lasted: (error, outageMs) =>
        calls.push(`lasted ${(error as Error).message} ${outageMs}`),
      ended: (outageMs) => calls.push(`ended ${outageMs}`),
    },
  };
}

describe('createOutageWatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('begins on the first failure, says once that it lasted, and ends on the first success', () => {
    const { calls, hooks } = recorded();
    const watch = createOutageWatch(60_000, hooks);

    watch.failed(new Error('a'));
    vi.advanceTimersByTime(30_000);
    watch.failed(new Error('b'));
    vi.advanceTimersByTime(30_000);
    watch.failed(new Error('c'));
    vi.advanceTimersByTime(30_000);
    watch.failed(new Error('d'));
    vi.advanceTimersByTime(10_000);
    watch.recovered();
    watch.recovered();

    expect(calls).toEqual(['began a', 'lasted c 60000', 'ended 100000']);
  });

  it('watches the next outage afresh once one ended', () => {
    const { calls, hooks } = recorded();
    const watch = createOutageWatch(60_000, hooks);

    watch.failed(new Error('first'));
    vi.advanceTimersByTime(60_000);
    watch.failed(new Error('still'));
    watch.recovered();
    vi.advanceTimersByTime(5_000);
    watch.failed(new Error('second'));
    vi.advanceTimersByTime(60_000);
    watch.failed(new Error('again'));

    expect(calls).toEqual([
      'began first',
      'lasted still 60000',
      'ended 60000',
      'began second',
      'lasted again 60000',
    ]);
  });

  it('says nothing of a success with no outage to end', () => {
    const { calls, hooks } = recorded();
    const watch = createOutageWatch(60_000, hooks);

    watch.recovered();

    expect(calls).toEqual([]);
  });

  it('keeps one outage across any gap unless asked to forget', () => {
    const { calls, hooks } = recorded();
    const watch = createOutageWatch(60_000, hooks);

    watch.failed(new Error('first'));
    vi.advanceTimersByTime(60 * 60_000);
    watch.failed(new Error('hour later'));

    expect(calls).toEqual(['began first', 'lasted hour later 3600000']);
  });

  it('begins a new outage after a quiet gap of forgetAfterMs, so an unseen recovery suppresses nothing', () => {
    const { calls, hooks } = recorded();
    const watch = createOutageWatch(60_000, hooks, {
      forgetAfterMs: 15 * 60_000,
    });

    watch.failed(new Error('first'));
    vi.advanceTimersByTime(61_000);
    watch.failed(new Error('reported'));
    // No query in between succeeded, so the end of that outage went unseen.
    vi.advanceTimersByTime(15 * 60_000);
    watch.failed(new Error('next'));
    vi.advanceTimersByTime(30_000);
    watch.failed(new Error('young'));
    vi.advanceTimersByTime(31_000);
    watch.failed(new Error('reported again'));

    expect(calls).toEqual([
      'began first',
      'lasted reported 61000',
      'began next',
      'lasted reported again 61000',
    ]);
  });

  it('keeps one outage while its failures come closer together than that', () => {
    const { calls, hooks } = recorded();
    const watch = createOutageWatch(60_000, hooks, {
      forgetAfterMs: 15 * 60_000,
    });

    watch.failed(new Error('first'));
    vi.advanceTimersByTime(14 * 60_000);
    watch.failed(new Error('retry'));
    vi.advanceTimersByTime(14 * 60_000);
    watch.failed(new Error('retry again'));

    expect(calls).toEqual(['began first', 'lasted retry 840000']);
  });
});
