import { afterEach, describe, expect, it, vi } from 'vitest';

import { ROUTE_READ_WAIT_MS, waitForRead } from './route-read';

afterEach(() => {
  vi.useRealTimers();
});

/** Whether `promise` has settled, without waiting for it. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  const mark = () => {
    done = true;
    return done;
  };
  void promise.then(mark, mark);
  // The turn the promise settles in, and the one its callback runs in.
  await Promise.resolve();
  await Promise.resolve();
  return done;
}

describe('waitForRead', () => {
  it('is over as soon as the read answers', async () => {
    const onFailure = vi.fn();
    await expect(
      waitForRead(Promise.resolve({ counts: {} }), onFailure),
    ).resolves.toBeUndefined();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('never fails: a read that fails is handed to onFailure', async () => {
    const failure = new Error('the server is gone');
    const onFailure = vi.fn();
    await expect(
      waitForRead(Promise.reject(failure), onFailure),
    ).resolves.toBeUndefined();
    expect(onFailure).toHaveBeenCalledWith(failure);
  });

  it('stops waiting for a read that takes longer, which goes on', async () => {
    vi.useFakeTimers();
    let answer!: () => void;
    const read = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const waiting = waitForRead(read, vi.fn());

    await vi.advanceTimersByTimeAsync(ROUTE_READ_WAIT_MS - 1);
    expect(await settled(waiting)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled(waiting)).toBe(true);
    answer();
  });

  it('still hands a late failure to onFailure, so nothing is left unhandled', async () => {
    vi.useFakeTimers();
    let fail!: (error: Error) => void;
    const read = new Promise<void>((_, reject) => {
      fail = reject;
    });
    const onFailure = vi.fn();
    const waiting = waitForRead(read, onFailure);
    await vi.advanceTimersByTimeAsync(ROUTE_READ_WAIT_MS);
    await waiting;

    fail(new Error('late'));
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledTimes(1));
  });
});
