import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UploadTimeoutError, withDeadline } from './upload-deadline';

describe('withDeadline', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves with the value when the promise settles before the deadline', async () => {
    const result = withDeadline(Promise.resolve('ok'), 1000, undefined);
    await expect(result).resolves.toBe('ok');
  });

  it('propagates the underlying rejection unchanged', async () => {
    const boom = new Error('server rejected');
    const result = withDeadline(Promise.reject(boom), 1000, undefined);
    await expect(result).rejects.toBe(boom);
  });

  it('rejects with UploadTimeoutError when the deadline elapses first', async () => {
    // A promise that never settles — the classic wedged-mutation case that
    // used to hang the upload loop and stick the dialog latch.
    const pending = new Promise<string>(() => {});
    const result = withDeadline(pending, 5000, undefined);
    const assertion = expect(result).rejects.toBeInstanceOf(UploadTimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it('rejects with AbortError when the signal fires before the deadline', async () => {
    const controller = new AbortController();
    const pending = new Promise<string>(() => {});
    const result = withDeadline(pending, 5000, controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = withDeadline(
      Promise.resolve('never'),
      5000,
      controller.signal,
    );
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
});
