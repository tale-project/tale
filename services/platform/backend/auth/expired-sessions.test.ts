// @vitest-environment node

/**
 * The expired-session reaper's contract with the table: it deletes only rows
 * whose `"expiresAt"` lies more than the grace behind now, a bounded batch
 * per statement, and stops when a batch comes back short, when its batch
 * budget is spent, or when the job is aborted. Which real rows go is proven
 * against Postgres by the `checkExpiredSessionReaper` lane of
 * `backend:integration` (`expired-sessions.integration.ts`).
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  EXPIRED_SESSION_BATCH,
  EXPIRED_SESSION_GRACE_MS,
  reapExpiredSessions,
} from './expired-sessions.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/** A handle whose every DELETE answers the next count in `counts` (0 once
 * they run out), recording each statement and its bound values. */
function recordingSql(
  counts: number[],
  onStatement?: (index: number) => void,
): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.raw.join('$').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    onStatement?.(statements.length - 1);
    const count = counts[statements.length - 1] ?? 0;
    return Promise.resolve(Object.assign([], { count }));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- recording stub for an unconstructable third-party branded type
  return { sql: tag as unknown as Sql, statements };
}

const NOW = Date.UTC(2026, 8, 27, 3, 0, 0);

describe('reapExpiredSessions', () => {
  it('deletes only sessions whose expiry lies more than the grace behind now', async () => {
    const { sql, statements } = recordingSql([0]);
    await reapExpiredSessions(sql, { now: NOW });

    expect(statements).toHaveLength(1);
    const [statement] = statements;
    expect(statement?.text).toBe(
      'DELETE FROM "session" WHERE "id" IN ( SELECT "id" FROM "session" WHERE "expiresAt" < $ LIMIT $ FOR UPDATE SKIP LOCKED )',
    );
    // The cutoff is the grace behind now: a session that expired an hour
    // ago is still inside it, one that expired two days ago is not.
    expect(statement?.values).toEqual([
      new Date(NOW - EXPIRED_SESSION_GRACE_MS),
      EXPIRED_SESSION_BATCH,
    ]);
    expect(EXPIRED_SESSION_GRACE_MS).toBe(24 * 3_600_000);
  });

  it('honours a caller-supplied grace', async () => {
    const { sql, statements } = recordingSql([0]);
    await reapExpiredSessions(sql, { now: NOW, graceMs: 60_000 });
    expect(statements[0]?.values[0]).toEqual(new Date(NOW - 60_000));
  });

  it('keeps deleting full batches until one comes back short', async () => {
    const { sql, statements } = recordingSql([10, 10, 3]);
    const result = await reapExpiredSessions(sql, { now: NOW, batch: 10 });
    expect(result).toEqual({ deleted: 23, drained: true });
    expect(statements).toHaveLength(3);
    expect(statements.every((row) => row.values[1] === 10)).toBe(true);
  });

  it('runs a single statement when nothing is due', async () => {
    const { sql, statements } = recordingSql([0]);
    const result = await reapExpiredSessions(sql, { now: NOW });
    expect(result).toEqual({ deleted: 0, drained: true });
    expect(statements).toHaveLength(1);
  });

  it('stops at its batch budget and says it did not drain', async () => {
    const { sql, statements } = recordingSql([5, 5, 5, 5, 5]);
    const result = await reapExpiredSessions(sql, {
      now: NOW,
      batch: 5,
      maxBatches: 3,
    });
    expect(result).toEqual({ deleted: 15, drained: false });
    expect(statements).toHaveLength(3);
  });

  it('stops between batches once the job is aborted', async () => {
    const controller = new AbortController();
    const { sql, statements } = recordingSql([5, 5, 5], (index) => {
      if (index === 0) controller.abort();
    });
    const result = await reapExpiredSessions(sql, {
      now: NOW,
      batch: 5,
      signal: controller.signal,
    });
    expect(result).toEqual({ deleted: 5, drained: false });
    expect(statements).toHaveLength(1);
  });

  it('touches nothing when aborted before it starts', async () => {
    const controller = new AbortController();
    controller.abort();
    const { sql, statements } = recordingSql([5]);
    const result = await reapExpiredSessions(sql, {
      now: NOW,
      signal: controller.signal,
    });
    expect(result).toEqual({ deleted: 0, drained: false });
    expect(statements).toHaveLength(0);
  });
});
