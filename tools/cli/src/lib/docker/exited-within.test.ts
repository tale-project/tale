import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import { exitedWithin } from './exited-within';

describe('exitedWithin', () => {
  const setTimeoutSpy = spyOn(globalThis, 'setTimeout');
  const clearTimeoutSpy = spyOn(globalThis, 'clearTimeout');

  afterEach(() => {
    setTimeoutSpy.mockClear();
    clearTimeoutSpy.mockClear();
  });

  test('clears the timeout timer once the child has exited', async () => {
    // A pending ref'd timer keeps the event loop alive: `tale backup` used to
    // stay resident for the whole archive timeout (up to 4 h) after its last
    // line of output, then kill an already-exited process.
    let killed = false;
    const proc = {
      exited: Promise.resolve(0),
      kill: () => {
        killed = true;
      },
    };

    await expect(exitedWithin(proc, 3600)).resolves.toBe(0);

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    const timer = setTimeoutSpy.mock.results[0]?.value;
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
    expect(killed).toBe(false);
  });

  test('clears the timer when the child exits non-zero, too', async () => {
    const proc = { exited: Promise.resolve(2), kill: () => {} };

    await expect(exitedWithin(proc, 3600)).resolves.toBe(2);

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  test('kills the child and rejects when the timeout fires', async () => {
    let killed = false;
    const proc = {
      exited: new Promise<number>(() => {}),
      kill: () => {
        killed = true;
      },
    };

    await expect(exitedWithin(proc, 0.01)).rejects.toThrow(
      'Command timed out after 0.01s',
    );
    expect(killed).toBe(true);
  });
});
