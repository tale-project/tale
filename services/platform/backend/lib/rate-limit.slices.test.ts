// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  checkUserRateLimit,
  RATE_LIMITS,
  RateLimitExceededError,
} from './rate-limit.ts';

/**
 * `rest:api` is charged on every request through the /api/v1 doors, so each
 * process spends it from slices it leases in one write. These tests drive
 * the limiter against one `app.rate_limits` table that several clients share,
 * as processes share the database, on clocks the test moves.
 */

const RULE = RATE_LIMITS['rest:api'];
const RATE_PER_MS = RULE.rate / RULE.period;
const EPOCH = Date.UTC(2026, 10, 1);

let elapsed = 0;

beforeEach(() => {
  elapsed = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => EPOCH + elapsed);
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Write {
  name: string;
  key: string;
  count: number;
  ceiling: number;
}

/**
 * The shared table. It plays the token-bucket charge from the statement's
 * own parameters (the stamp, the ceiling, the refill per ms and the count)
 * with Postgres's arithmetic, and the read-back the refusal makes, and
 * records every charge it answered.
 */
function sharedTable(): {
  client: () => Sql;
  writes: Write[];
  tokens: (key?: string) => number;
} {
  const rows = new Map<string, { value: number; ts: number }>();
  const writes: Write[] = [];
  const client = (): Sql => {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('$?').replace(/\s+/g, ' ').trim();
      if (text.startsWith('INSERT INTO app.rate_limits')) {
        const [name, key, inserted, now, ceiling, , ratePerMs, count] =
          values as [
            string,
            string,
            number,
            number,
            number,
            number,
            number,
            number,
          ];
        writes.push({ name, key, count, ceiling });
        const id = `${name}|${key}`;
        const row = rows.get(id);
        if (row === undefined) {
          rows.set(id, { value: inserted, ts: now });
          return Promise.resolve([{ value: String(inserted) }]);
        }
        const available = Math.min(
          ceiling,
          row.value + (now - row.ts) * ratePerMs,
        );
        if (available < count) {
          return Promise.resolve([]);
        }
        rows.set(id, { value: available - count, ts: now });
        return Promise.resolve([{ value: String(available - count) }]);
      }
      if (
        text.startsWith('SELECT value::text, ts::text FROM app.rate_limits')
      ) {
        const row = rows.get(`${String(values[0])}|${String(values[1])}`);
        return Promise.resolve(
          row === undefined
            ? []
            : [{ value: String(row.value), ts: String(row.ts) }],
        );
      }
      return Promise.reject(new Error(`unexpected statement: ${text}`));
    };
    return tag as unknown as Sql;
  };
  const tokens = (key = 'user:user-1'): number => {
    const row = rows.get(`rest:api|${key}`);
    return row === undefined ? RULE.capacity : row.value;
  };
  return { client, writes, tokens };
}

/** One request's charge: admitted, or the `retryAfter` it was refused with. */
async function charge(
  sql: Sql,
  name: 'rest:api' | 'rest:execute' = 'rest:api',
): Promise<'admitted' | number> {
  try {
    await checkUserRateLimit(sql, name, 'user-1');
    return 'admitted';
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return error.retryAfter;
    }
    throw error;
  }
}

/** The most admissions any window holds beyond `capacity + rate × window`. */
function worstExcess(admittedAt: number[]): number {
  let worst = Number.NEGATIVE_INFINITY;
  for (let first = 0; first < admittedAt.length; first++) {
    for (let last = first; last < admittedAt.length; last++) {
      const allowed =
        RULE.capacity +
        ((admittedAt[last] ?? 0) - (admittedAt[first] ?? 0)) * RATE_PER_MS;
      worst = Math.max(worst, last - first + 1 - allowed);
    }
  }
  return worst;
}

describe('rest:api spent from leased slices', () => {
  test('two processes driven far past the limit admit no more than the bucket allows in any window', async () => {
    const table = sharedTable();
    const processes = [table.client(), table.client()];
    const admittedAt: number[] = [];
    // 30 seconds of 120 requests a second, split over both processes.
    for (let step = 0; step < 600; step++) {
      elapsed = step * 50;
      for (const sql of processes) {
        for (let request = 0; request < 3; request++) {
          if ((await charge(sql)) === 'admitted') admittedAt.push(elapsed);
        }
      }
    }
    expect(worstExcess(admittedAt)).toBeLessThanOrEqual(1e-9);
    // Exact, not merely safe: the burst less one lifetime's refill, then the
    // sustained rate.
    const lifetimeRefill = RULE.slices.lifetime * RATE_PER_MS;
    expect(admittedAt.length).toBeGreaterThanOrEqual(
      RULE.capacity - lifetimeRefill + 30_000 * RATE_PER_MS - 2,
    );
  });

  test('a slice spent at the end of its lifetime adds nothing to what another process takes then', async () => {
    const table = sharedTable();
    const [first, second] = [table.client(), table.client()];
    // Eight requests: one token at once, then slices of 2, 4 and 8, of
    // which 7 tokens stay unspent.
    for (let request = 0; request < 8; request++) {
      expect(await charge(first)).toBe('admitted');
    }
    expect(table.writes.map((write) => write.count)).toEqual([1, 2, 4, 8]);

    // Just before that slice lapses, the other process drains the row and
    // the first spends what it holds.
    elapsed = RULE.slices.lifetime - 1;
    let drained = 0;
    while ((await charge(second)) === 'admitted') drained += 1;
    let held = 0;
    while ((await charge(first)) === 'admitted') held += 1;

    expect(held).toBe(7);
    expect(drained + held).toBeLessThanOrEqual(RULE.capacity);
    expect(8 + drained + held).toBeLessThanOrEqual(
      RULE.capacity + elapsed * RATE_PER_MS,
    );
  });

  test('a slice is not spent after its lifetime, and the next charge writes', async () => {
    const table = sharedTable();
    const sql = table.client();
    for (let request = 0; request < 8; request++) await charge(sql);
    const tokensBefore = table.tokens();

    elapsed = RULE.slices.lifetime;
    expect(await charge(sql)).toBe('admitted');

    expect(table.writes).toHaveLength(5);
    // The 7 unspent tokens were dropped, not handed back.
    expect(table.tokens()).toBeCloseTo(
      tokensBefore + elapsed * RATE_PER_MS - 1,
      9,
    );
  });

  test('a key holder well below its limit writes once per several requests', async () => {
    const table = sharedTable();
    const sql = table.client();
    // One request a second for a minute: half the sustained rate.
    for (let second = 0; second < 60; second++) {
      elapsed = second * 1000;
      expect(await charge(sql)).toBe('admitted');
    }
    expect(table.writes.length).toBeLessThanOrEqual(60 / 4);
    expect(table.writes[0]).toEqual({
      name: 'rest:api',
      key: 'user:user-1',
      count: 1,
      ceiling: RULE.capacity,
    });
  });

  test('a burst writes once per slice, the largest slice at most', async () => {
    const table = sharedTable();
    const sql = table.client();
    for (let request = 0; request < 100; request++) {
      expect(await charge(sql)).toBe('admitted');
    }
    expect(table.writes.map((write) => write.count)).toEqual([
      1, 2, 4, 8, 10, 10, 10, 10, 10, 10, 10, 10, 10,
    ]);
    const lifetimeRefill = RULE.slices.lifetime * RATE_PER_MS;
    for (const write of table.writes.slice(1)) {
      expect(write.ceiling).toBe(RULE.capacity - lifetimeRefill);
    }
  });

  test('concurrent requests of one key holder share the lease in flight', async () => {
    const table = sharedTable();
    const sql = table.client();
    // Warm up to an empty, live slice of 4.
    for (let request = 0; request < 7; request++) await charge(sql);
    expect(table.writes).toHaveLength(3);

    const answers = await Promise.all(
      Array.from({ length: 20 }, () => charge(sql)),
    );
    expect(answers.every((answer) => answer === 'admitted')).toBe(true);
    expect(table.writes.slice(3).map((write) => write.count)).toEqual([
      8, 10, 10,
    ]);
  });

  test('a spent bucket refuses with the time to its next token, as a charge per request did', async () => {
    const table = sharedTable();
    const sql = table.client();
    let admitted = 0;
    let answer = await charge(sql);
    while (answer === 'admitted') {
      admitted += 1;
      answer = await charge(sql);
    }
    // The first token at once from the full bucket, then slices that leave a
    // lifetime's refill unclaimed.
    expect(admitted).toBe(
      1 + RULE.capacity - RULE.slices.lifetime * RATE_PER_MS,
    );
    expect(answer).toBe(Math.ceil((1 - table.tokens()) / RATE_PER_MS));
    expect(answer).toBeGreaterThanOrEqual(1);
    await expect(checkUserRateLimit(sql, 'rest:api', 'user-1')).rejects.toThrow(
      /^Rate limit exceeded for rest:api\. Try again in/,
    );

    // One token later the next request is admitted, one token at a time.
    elapsed += answer;
    expect(await charge(sql)).toBe('admitted');
    expect(table.writes.at(-1)).toMatchObject({
      count: 1,
      ceiling: RULE.capacity,
    });
    expect(await charge(sql)).not.toBe('admitted');
  });

  test('every other rule keeps one charge per request', async () => {
    const table = sharedTable();
    const sql = table.client();
    for (let request = 0; request < 10; request++) {
      expect(await charge(sql, 'rest:execute')).toBe('admitted');
    }
    expect(table.writes).toHaveLength(10);
    expect(
      Object.entries(RATE_LIMITS)
        .filter(([, rule]) => 'slices' in rule)
        .map(([name]) => name),
    ).toEqual(['rest:api']);
  });

  test('a sliced rule leaves room under its ceiling for its largest slice', () => {
    for (const rule of Object.values(RATE_LIMITS)) {
      if (rule.kind !== 'token bucket' || !('slices' in rule)) continue;
      const ceiling =
        rule.capacity - (rule.slices.lifetime * rule.rate) / rule.period;
      expect(rule.slices.largest).toBeGreaterThanOrEqual(2);
      expect(ceiling).toBeGreaterThanOrEqual(2 * rule.slices.largest);
      // A process forgets a slice a minute after its lease.
      expect(rule.slices.lifetime).toBeLessThan(60_000);
    }
  });
});
