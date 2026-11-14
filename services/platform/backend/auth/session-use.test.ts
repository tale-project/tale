// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SESSION_USE_STAMP_MAX_SECONDS,
  type SessionUseRow,
  sessionUseStampSeconds,
  stampSessionUse,
} from './session-use.ts';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** A stand-in for the pool that counts the writes it is asked to make. */
function countingSql() {
  const writes: unknown[][] = [];
  const sql = (_strings: TemplateStringsArray, ...values: unknown[]) => {
    writes.push(values);
    return Promise.resolve([]);
  };
  return { sql: sql as unknown as Sql, writes };
}

/** A regular row, minted seven days before its last refresh, as Better Auth
 * writes it at the default lifetime: the sort of row a stamp must not touch. */
function regularRow(updatedAt: number, lifetime = 7 * DAY): SessionUseRow {
  return {
    updatedAt: new Date(updatedAt),
    expiresAt: new Date(updatedAt + lifetime),
  };
}

describe('the write a session use costs, counted per kind of row', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '');
    vi.stubEnv('SESSION_COOKIE_CACHE_SECONDS', '');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it.each([
    [
      'a single sign-on row, whose first slide is weeks away',
      {
        updatedAt: new Date(NOW - 10 * MINUTE),
        expiresAt: new Date(NOW + 30 * DAY),
      },
      1,
    ],
    [
      'a "don\'t remember me" row, which Better Auth never slides',
      {
        updatedAt: new Date(NOW - 10 * MINUTE),
        expiresAt: new Date(NOW + DAY),
      },
      1,
    ],
    ['a regular row Better Auth has just refreshed', regularRow(NOW), 0],
    [
      'a regular row whose refresh is due in the future',
      regularRow(NOW - 2 * MINUTE),
      0,
    ],
    [
      'a regular row whose refresh is overdue beyond the cookie cache',
      regularRow(NOW - 10 * MINUTE),
      1,
    ],
  ])(
    'without the cookie cache, %s: %i write(s)',
    async (_name, row, expected) => {
      const { sql, writes } = countingSql();
      await stampSessionUse(sql, 'session-a', row, NOW);
      expect(writes).toHaveLength(expected);
    },
  );

  it('with the cookie cache, a refresh deferred within the cache writes nothing', async () => {
    vi.stubEnv('SESSION_COOKIE_CACHE_SECONDS', '60');
    const { sql, writes } = countingSql();
    await stampSessionUse(sql, 'session-a', regularRow(NOW - 5 * MINUTE), NOW);
    expect(writes).toHaveLength(0);
  });

  it('with the cookie cache, a refresh overdue beyond it writes', async () => {
    vi.stubEnv('SESSION_COOKIE_CACHE_SECONDS', '60');
    const { sql, writes } = countingSql();
    await stampSessionUse(sql, 'session-a', regularRow(NOW - 10 * MINUTE), NOW);
    expect(writes).toHaveLength(1);
  });

  it('under an idle window, a regular row overdue for its refresh writes once', async () => {
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '30');
    const { sql, writes } = countingSql();
    await stampSessionUse(
      sql,
      'session-a',
      regularRow(NOW - 10 * MINUTE, 30 * MINUTE),
      NOW,
    );
    expect(writes).toHaveLength(1);
  });
});

describe('how old a recorded use gets before a request records a new one', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    // Better Auth's cadence without an idle window here.
    [60, 60],
    // A cadence tuned longer is still held to the minute.
    [300, SESSION_USE_STAMP_MAX_SECONDS],
    // A window of a minute refreshes every 30 seconds, and records as often.
    [30, 30],
  ])('follows a refresh cadence of %is: %is', (updateAge, seconds) => {
    expect(sessionUseStampSeconds(updateAge)).toBe(seconds);
  });

  it('reads the cadence the deployment runs Better Auth with', () => {
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '');
    expect(sessionUseStampSeconds()).toBe(60);
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '1');
    expect(sessionUseStampSeconds()).toBe(30);
  });
});
