import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  type ModelCapacityHold,
  MODEL_CAPACITY_MAX_WAIT_MS,
  MODEL_CAPACITY_PROBE_PROOF_MS,
  MODEL_CAPACITY_RAMP_MS,
  MODEL_CAPACITY_WAKE_SPACING_MS,
  modelCapacityBackoffMs,
  modelCapacityKey,
  modelCapacityRamp,
  modelCapacityWakeDelaysMs,
  recordModelCapacityRefusalInTx,
  renewModelCapacityProbeInTx,
} from './model-capacity-holds.ts';

describe('the wait a model at capacity imposes [TASK-R40]', () => {
  it('waits 1, 2, 4, 8, then 15 minutes as the refusals go on', () => {
    const middle = () => 0.5;
    expect(
      [1, 2, 3, 4, 5, 6, 20].map((n) => modelCapacityBackoffMs(n, middle)),
    ).toEqual([60_000, 120_000, 240_000, 480_000, 900_000, 900_000, 900_000]);
  });

  it('spreads the runs it parks over ±10 % so they do not wake in lockstep', () => {
    expect(modelCapacityBackoffMs(1, () => 0)).toBe(54_000);
    expect(modelCapacityBackoffMs(1, () => 1)).toBe(66_000);
  });

  it('reads a malformed count as the first refusal', () => {
    expect(modelCapacityBackoffMs(0, () => 0.5)).toBe(60_000);
    expect(modelCapacityBackoffMs(Number.NaN, () => 0.5)).toBe(60_000);
  });

  it('lets a probe prove the model in two minutes and gives up after twelve hours', () => {
    expect(MODEL_CAPACITY_PROBE_PROOF_MS).toBe(2 * 60_000);
    expect(MODEL_CAPACITY_MAX_WAIT_MS).toBe(12 * 60 * 60_000);
  });
});

describe('a model that answers again wakes its waiters in waves [TASK-R40]', () => {
  /** How many runs start at each delay, in order. */
  function waves(count: number): number[] {
    const sizes = new Map<number, number>();
    for (const delay of modelCapacityWakeDelaysMs(count)) {
      sizes.set(delay, (sizes.get(delay) ?? 0) + 1);
    }
    return [...sizes.values()];
  }

  it('wakes a few waiters one at a time, 15 seconds apart', () => {
    expect(modelCapacityWakeDelaysMs(0)).toEqual([]);
    expect(modelCapacityWakeDelaysMs(1)).toEqual([0]);
    expect(modelCapacityWakeDelaysMs(4)).toEqual([0, 15_000, 30_000, 45_000]);
    expect(waves(16)).toEqual(Array.from({ length: 16 }, () => 1));
    expect(MODEL_CAPACITY_WAKE_SPACING_MS).toBe(15_000);
  });

  it('starts many with one run, then twice as many each wave, up to a sixteenth of them', () => {
    expect(waves(256)).toEqual([
      1, 2, 4, 8, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 1,
    ]);
    expect(Math.max(...waves(500))).toBe(32);
  });

  it('wakes them oldest park first, every one within five minutes', () => {
    for (const count of [17, 64, 256, 500]) {
      const delays = modelCapacityWakeDelaysMs(count);
      expect(delays).toHaveLength(count);
      expect(delays).toEqual([...delays].sort((a, b) => a - b));
      expect(delays.at(-1)).toBeLessThanOrEqual(5 * 60_000);
    }
    // 256 waiters: the last of 20 waves, where one at a time took 63:45.
    expect(modelCapacityWakeDelaysMs(256).at(-1)).toBe(19 * 15_000);
  });

  it('reads a malformed count as none', () => {
    expect(modelCapacityWakeDelaysMs(Number.NaN)).toEqual([]);
    expect(modelCapacityWakeDelaysMs(-3)).toEqual([]);
  });
});

describe('new work on a model that answers again ramps up in the same waves [TASK-R43]', () => {
  const clearedAt = 1_000_000;
  /** The new runs the ramp has let through `seconds` after the clear. */
  const allowedAt = (seconds: number) =>
    modelCapacityRamp(clearedAt, clearedAt + seconds * 1000)?.allowed ?? null;

  it('lets one run through at once, then twice as many each wave, then 32 every 15 seconds', () => {
    expect([0, 14, 15, 30, 45, 60, 75, 90, 105].map(allowedAt)).toEqual([
      1, 1, 3, 7, 15, 31, 63, 95, 127,
    ]);
  });

  it('names when its next wave comes', () => {
    expect(modelCapacityRamp(clearedAt, clearedAt)).toEqual({
      allowed: 1,
      nextWaveAtMs: clearedAt + MODEL_CAPACITY_WAKE_SPACING_MS,
    });
    expect(modelCapacityRamp(clearedAt, clearedAt + 20_000)).toEqual({
      allowed: 3,
      nextWaveAtMs: clearedAt + 30_000,
    });
  });

  it('is over once its last wave came, within five minutes of the clear', () => {
    // The waves of 500 runs: the last at 4 min 45 s lets the rest through.
    expect(allowedAt(284)).toBe(479);
    expect(allowedAt(285)).toBeNull();
    expect(MODEL_CAPACITY_RAMP_MS).toBe(5 * 60_000);
    expect(
      modelCapacityRamp(clearedAt, clearedAt + MODEL_CAPACITY_RAMP_MS),
    ).toBeNull();
  });

  it('reads a clock behind the clear as the first wave, and a broken one as no ramp', () => {
    expect(modelCapacityRamp(clearedAt, clearedAt - 5_000)).toEqual({
      allowed: 1,
      nextWaveAtMs: clearedAt + MODEL_CAPACITY_WAKE_SPACING_MS,
    });
    expect(modelCapacityRamp(clearedAt, Number.NaN)).toBeNull();
  });

  it('keys a model by its provider, an absent provider being one of its own', () => {
    expect(modelCapacityKey({ modelProvider: null, model: 'm' })).toBe(
      modelCapacityKey({ modelProvider: '', model: 'm' }),
    );
    expect(modelCapacityKey({ modelProvider: 'a', model: 'm' })).not.toBe(
      modelCapacityKey({ modelProvider: 'b', model: 'm' }),
    );
  });
});

/** A postgres.js tagged-template stand-in: each statement's text (whitespace
 * collapsed) and values, answered by `answer` from the statement's text and
 * its place among the statements. */
function fakeTx(
  answer: (text: string, index: number) => Array<Record<string, unknown>>,
): { tx: TransactionSql; calls: { text: string; values: unknown[] }[] } {
  const calls: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    calls.push({ text, values });
    return Promise.resolve(answer(text, calls.length - 1));
  };
  const tx = Object.assign(tag, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a two-member stand-in for the postgres.js template function
  return { tx: tx as unknown as TransactionSql, calls };
}

describe('a probe whose harness retries a refused call proves nothing [TASK-R40]', () => {
  const NOW = Date.UTC(2026, 10, 4, 10, 3, 0);
  const KEY = {
    organizationId: 'org-1',
    modelProvider: 'anthropic',
    model: 'claude-opus-5-5',
  };
  const READ = 'SELECT ? FROM app.model_capacity_holds';
  const LOCK = 'SELECT pg_advisory_xact_lock(';
  const UPDATE = 'UPDATE app.model_capacity_holds SET';
  /** The hold the claim at 10:01 took: run-1 probes the model. */
  const probed = (
    over: Partial<ModelCapacityHold> = {},
  ): ModelCapacityHold => ({
    heldUntilMs: NOW - 2 * 60_000,
    consecutive: 1,
    firstRefusedAtMs: NOW - 3 * 60_000,
    lastRefusedAtMs: NOW - 3 * 60_000,
    lastRunId: 'run-0',
    probeRunId: 'run-1',
    probeClaimedAtMs: NOW - 2 * 60_000,
    ...over,
  });
  /** A transaction that reads `before` first, then `after` under the lock. */
  const holds = (
    before: ModelCapacityHold | null,
    after: ModelCapacityHold | null = before,
  ) => {
    let reads = 0;
    return fakeTx((text) => {
      if (!text.startsWith(READ)) return [];
      reads++;
      const hold = reads === 1 ? before : after;
      return hold === null ? [] : [{ ...hold }];
    });
  };
  const renew = (tx: TransactionSql, retryDelayMs: number, runId = 'run-1') =>
    renewModelCapacityProbeInTx(tx, { ...KEY, runId, retryDelayMs, now: NOW });
  /** The statements, each by how it opens. */
  const opened = (calls: { text: string }[]) =>
    calls.map(
      ({ text }) =>
        [READ, LOCK, UPDATE].find((prefix) => text.startsWith(prefix)) ?? text,
    );

  it('renews the claim to the retry under the lock the claims and refusals take', async () => {
    const { tx, calls } = holds(probed());
    await expect(renew(tx, 2_009)).resolves.toBe(true);
    expect(opened(calls)).toEqual([READ, LOCK, READ, UPDATE]);
    // The others wait two minutes past the retried call, at 10:05:02.
    expect(calls[3]).toEqual({
      text: 'UPDATE app.model_capacity_holds SET probe_claimed_at_ms = ?, updated_at_ms = ? WHERE org_id = ? AND model_provider = ? AND model = ? AND probe_run_id = ?',
      values: [
        NOW + 2_009,
        NOW,
        'org-1',
        'anthropic',
        'claude-opus-5-5',
        'run-1',
      ],
    });
    // The very lock a refusal of the model takes: the two serialize.
    const refusal = fakeTx(() => []);
    await recordModelCapacityRefusalInTx(refusal.tx, {
      ...KEY,
      runId: 'run-1',
      now: NOW,
    });
    expect(refusal.calls[0]).toEqual(calls[1]);
  });

  it('only moves the claim later', async () => {
    const { tx, calls } = holds(probed({ probeClaimedAtMs: NOW + 38_839 }));
    await expect(renew(tx, 566)).resolves.toBe(true);
    expect(calls[3]?.values[0]).toBe(NOW + 38_839);
  });

  it.each([
    // The longest a hold waits after a refusal.
    [60 * 60_000, NOW + 15 * 60_000],
    // A whole millisecond: the claim is a bigint column.
    [566.4, NOW + 566],
    [-1, NOW],
    [Number.NaN, NOW],
    [Number.POSITIVE_INFINITY, NOW],
  ])(
    'credits a retry’s wait of %d ms up to the longest a hold waits',
    async (retryDelayMs, claimedAt) => {
      const { tx, calls } = holds(probed({ probeClaimedAtMs: null }));
      await expect(renew(tx, retryDelayMs)).resolves.toBe(true);
      expect(calls[3]?.values[0]).toBe(claimedAt);
    },
  );

  it.each([
    ['no hold stands', null],
    ['no run probes the model yet', probed({ probeRunId: null })],
    ['another run probes it', probed({ probeRunId: 'run-2' })],
  ])('writes nothing when %s', async (_case, hold) => {
    const { tx, calls } = holds(hold);
    await expect(renew(tx, 566)).resolves.toBe(false);
    expect(opened(calls)).toEqual([READ]);
  });

  it.each([
    // The probe's own refusal doubled the wait and freed the probe.
    ['a refusal', probed({ probeRunId: null, probeClaimedAtMs: null })],
    // A run on the model settled: it answers again.
    ['a clear', null],
  ])('writes nothing when %s landed before its lock', async (_case, after) => {
    const { tx, calls } = holds(probed(), after);
    await expect(renew(tx, 566)).resolves.toBe(false);
    expect(opened(calls)).toEqual([READ, LOCK, READ]);
  });
});
