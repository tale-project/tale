import { describe, expect, it, vi } from 'vitest';

import { createOutboxReclaimer, reclaimablePrefix } from './outbox.ts';

const row = (id: string, createdAtMs: number) => ({ id, createdAtMs });

describe('reclaimablePrefix', () => {
  it('takes the run of rows older than the cutoff and stops at the first retained one', () => {
    const rows = [row('1', 10), row('2', 20), row('3', 30), row('4', 40)];
    expect(reclaimablePrefix(rows, 30)).toEqual(['1', '2']);
  });

  it('keeps an older stamp that sits ABOVE a newer one (long-transaction skew): a strict prefix, never a hole', () => {
    // id 2 committed late with an old `created_at`; id 3 is fresh. Deleting
    // 2 would leave a resumed cursor at 1 unable to tell its replay is
    // incomplete, so the prefix stops at the first retained row.
    const rows = [row('1', 10), row('3', 50), row('2', 5), row('4', 60)];
    expect(reclaimablePrefix(rows, 30)).toEqual(['1']);
  });

  it('reclaims nothing while the oldest row is within the horizon', () => {
    expect(reclaimablePrefix([row('7', 100), row('8', 200)], 50)).toEqual([]);
    expect(reclaimablePrefix([], 50)).toEqual([]);
  });

  it('treats a row stamped exactly at the cutoff as retained', () => {
    expect(reclaimablePrefix([row('1', 30), row('2', 31)], 30)).toEqual([]);
  });
});

describe('createOutboxReclaimer', () => {
  it('sweeps on the first tick, then not again until the interval has passed', async () => {
    let clock = 1_000;
    const reclaim = vi.fn(() => Promise.resolve(3));
    const reclaimer = createOutboxReclaimer({
      reclaim,
      intervalMs: 60_000,
      budget: 100,
      now: () => clock,
    });
    await reclaimer.tick();
    await reclaimer.tick();
    expect(reclaim).toHaveBeenCalledTimes(1);
    clock += 59_999;
    await reclaimer.tick();
    expect(reclaim).toHaveBeenCalledTimes(1);
    clock += 1;
    await reclaimer.tick();
    expect(reclaim).toHaveBeenCalledTimes(2);
  });

  it('comes back sooner while a sweep spends its whole budget (a backlog drains)', async () => {
    let clock = 0;
    const reclaim = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(100)
      .mockResolvedValue(0);
    const reclaimer = createOutboxReclaimer({
      reclaim,
      intervalMs: 60_000,
      catchUpMs: 1_000,
      budget: 100,
      now: () => clock,
    });
    await reclaimer.tick(); // full budget → due again in 1s
    clock += 1_000;
    await reclaimer.tick(); // full budget again → 1s
    clock += 1_000;
    await reclaimer.tick(); // caught up → back to the interval
    clock += 1_000;
    await reclaimer.tick();
    expect(reclaim).toHaveBeenCalledTimes(3);
  });

  it('never overlaps sweeps and survives a failing one', async () => {
    let clock = 0;
    let release: (() => void) | undefined;
    const reclaim = vi
      .fn<() => Promise<number>>()
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            release = () => resolve(0);
          }),
      )
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValue(0);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reclaimer = createOutboxReclaimer({
      reclaim,
      intervalMs: 60_000,
      budget: 100,
      now: () => clock,
    });
    const first = reclaimer.tick();
    await reclaimer.tick(); // in flight → skipped
    expect(reclaim).toHaveBeenCalledTimes(1);
    release?.();
    await first;

    clock += 60_000;
    await expect(reclaimer.tick()).resolves.toBeUndefined(); // the rejection stays inside
    expect(error).toHaveBeenCalledTimes(1);
    clock += 60_000;
    await reclaimer.tick();
    expect(reclaim).toHaveBeenCalledTimes(3);
    error.mockRestore();
  });
});
