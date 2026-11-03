import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useBusySessions } from './use-busy-sessions';

/** A request the test settles when it wants to. */
function pending<T = string>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('useBusySessions', () => {
  it('knows nothing is busy to begin with', () => {
    const { result } = renderHook(() => useBusySessions());
    expect(result.current.isBusy('start', 1)).toBe(false);
    expect(result.current.isBusy('rotate', 1)).toBe(false);
  });

  it('says which action of which session is under way, and no other', () => {
    const { result } = renderHook(() => useBusySessions());
    const request = pending();

    act(() => {
      void result.current.track(4, 'start', request.promise);
    });

    expect(result.current.isBusy('start', 4)).toBe(true);
    expect(result.current.isBusy('rotate', 4)).toBe(false);
    expect(result.current.isBusy('start', 5)).toBe(false);
  });

  it('is done with the session when its request is, and hands the answer on', async () => {
    const { result } = renderHook(() => useBusySessions());
    const request = pending();
    let answer: Promise<string> | undefined;
    act(() => {
      answer = result.current.track(4, 'start', request.promise);
    });

    await act(async () => {
      request.resolve('started');
      await answer;
    });

    expect(await answer).toBe('started');
    expect(result.current.isBusy('start', 4)).toBe(false);
  });

  it('is done with the session when its request failed too, and the failure goes on', async () => {
    const { result } = renderHook(() => useBusySessions());
    const request = pending();
    let answer: Promise<string> | undefined;
    act(() => {
      answer = result.current.track(4, 'rotate', request.promise);
    });

    await act(async () => {
      request.reject(new Error('refused'));
      await expect(answer).rejects.toThrow('refused');
    });

    expect(result.current.isBusy('rotate', 4)).toBe(false);
  });

  it('stays busy until the last of two requests for the same session is over', async () => {
    const { result } = renderHook(() => useBusySessions());
    const first = pending();
    const second = pending();
    act(() => {
      void result.current.track(4, 'start', first.promise);
      void result.current.track(4, 'start', second.promise);
    });

    await act(async () => {
      first.resolve('a');
      await first.promise;
    });
    expect(result.current.isBusy('start', 4)).toBe(true);

    await act(async () => {
      second.resolve('b');
      await second.promise;
    });
    expect(result.current.isBusy('start', 4)).toBe(false);
  });
});
