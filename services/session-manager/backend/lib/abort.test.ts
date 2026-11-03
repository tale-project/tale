import { afterEach, describe, expect, it, vi } from 'vitest';

import { settle } from '../testing/promises.ts';
import {
  CancelledError,
  Latch,
  abortable,
  cancel,
  isCancelled,
  sleep,
} from './abort.ts';

afterEach(() => {
  vi.useRealTimers();
});

/** Watches a promise: `state` says how it ended. */
function track<T>(promise: Promise<T>) {
  const state: { kind: 'pending' | 'resolved' | 'rejected'; value?: unknown } =
    { kind: 'pending' };
  const resolved = (value: T): void => {
    state.kind = 'resolved';
    state.value = value;
  };
  const rejected = (error: unknown): void => {
    state.kind = 'rejected';
    state.value = error;
  };
  promise.then(resolved, rejected);
  return state;
}

describe('cancel', () => {
  it('aborts with a CancelledError that throwIfAborted raises', () => {
    const controller = new AbortController();
    cancel(controller, 'stopped');
    expect(controller.signal.aborted).toBe(true);
    let raised: unknown;
    try {
      controller.signal.throwIfAborted();
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(CancelledError);
    expect(isCancelled(raised)).toBe(true);
    expect(raised).toMatchObject({ message: 'stopped' });
    expect(isCancelled(new Error('other'))).toBe(false);
  });
});

describe('abortable', () => {
  it('gives the value of the promise', async () => {
    const controller = new AbortController();
    await expect(
      abortable(Promise.resolve(5), controller.signal),
    ).resolves.toBe(5);
  });

  it('gives the failure of the promise', async () => {
    const controller = new AbortController();
    await expect(
      abortable(Promise.reject(new Error('boom')), controller.signal),
    ).rejects.toThrow('boom');
  });

  it('rejects with the signal reason as soon as the signal aborts', async () => {
    const controller = new AbortController();
    const never = new Promise<never>(() => undefined);
    const waiting = track(abortable(never, controller.signal));
    await settle();
    expect(waiting.kind).toBe('pending');
    cancel(controller);
    await settle();
    expect(waiting.kind).toBe('rejected');
    expect(waiting.value).toBeInstanceOf(CancelledError);
  });

  it('rejects at once when the signal has aborted already', async () => {
    const controller = new AbortController();
    cancel(controller);
    await expect(
      abortable(Promise.resolve('late'), controller.signal),
    ).rejects.toBeInstanceOf(CancelledError);
  });

  it('leaves the promise to itself: its later failure is not unhandled', async () => {
    const controller = new AbortController();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { promise, reject } = Promise.withResolvers<never>();
      const waiting = abortable(promise, controller.signal);
      cancel(controller);
      await expect(waiting).rejects.toBeInstanceOf(CancelledError);
      reject(new Error('fails after the abort'));
      await settle();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('stops listening to the signal once the promise has settled', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await abortable(Promise.resolve(1), controller.signal);
    await settle();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

describe('sleep', () => {
  it('waits the given time', async () => {
    vi.useFakeTimers();
    const waiting = track(sleep(1000));
    await vi.advanceTimersByTimeAsync(999);
    expect(waiting.kind).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(waiting.kind).toBe('resolved');
  });

  it('ends early, without failing, when the signal aborts, and drops its timer', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waiting = track(sleep(60_000, controller.signal));
    await vi.advanceTimersByTimeAsync(10);
    expect(waiting.kind).toBe('pending');
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(waiting.kind).toBe('resolved');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not wait at all for a signal that has aborted already', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    const waiting = track(sleep(60_000, controller.signal));
    await vi.advanceTimersByTimeAsync(0);
    expect(waiting.kind).toBe('resolved');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Latch', () => {
  it('holds waiters back until it is set, then lets everybody through', async () => {
    const latch = new Latch();
    const first = track(latch.wait());
    const second = track(latch.wait());
    await settle();
    expect(first.kind).toBe('pending');
    expect(latch.isSet).toBe(false);

    latch.set();
    await settle();
    expect(first.kind).toBe('resolved');
    expect(second.kind).toBe('resolved');
    expect(latch.isSet).toBe(true);
    await latch.wait(); // and at once from now on
  });
});
