// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { createDrainProbe } from './drain-probe.ts';

/** Let the probe's background read settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('the drain probe', () => {
  it('answers not draining until its first read lands, then what it read', async () => {
    const read = vi.fn(async () => true);
    const probe = createDrainProbe(read, { now: () => 0 });

    expect(probe()).toBe(false);
    await settle();
    expect(probe()).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reads again only once the answer is older than the refresh interval', async () => {
    let clock = 0;
    const answers = [false, true];
    const read = vi.fn(async () => answers.shift() ?? true);
    const probe = createDrainProbe(read, {
      refreshMs: 5_000,
      now: () => clock,
    });

    probe();
    await settle();
    clock = 4_999;
    expect(probe()).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);

    clock = 5_000;
    probe();
    await settle();
    expect(probe()).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps its last answer when a read fails', async () => {
    let clock = 0;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const read = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('database restarting'));
    const probe = createDrainProbe(read, { refreshMs: 1, now: () => clock });

    probe();
    await settle();
    clock = 10;
    expect(probe()).toBe(true);
    await settle();
    expect(probe()).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      '[backend] drain probe read failed:',
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it('never runs two reads at once', async () => {
    let release: (answer: boolean) => void = () => {};
    const read = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    let clock = 0;
    const probe = createDrainProbe(read, { refreshMs: 1, now: () => clock });

    probe();
    clock = 100;
    probe();
    expect(read).toHaveBeenCalledTimes(1);
    release(true);
    await settle();
    expect(probe()).toBe(true);
  });
});
