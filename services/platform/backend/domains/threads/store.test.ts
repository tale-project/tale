// @vitest-environment node

/**
 * A message slot is unique: an append that loses the race for `max+1` gets
 * no row back from `ON CONFLICT DO NOTHING` and must claim the next slot on
 * a fresh statement — never land on the winner's slot, never surface the
 * lost race as an error while the deadline remains.
 */

import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  listThreadMessagesTail,
  MESSAGE_SLOT_CLAIM_DEADLINE_MS,
  saveMessage,
} from './store.ts';

/** A `tx` whose INSERTs answer from `outcomes` in order (an empty array is a
 * lost race), recording every statement so the retry count is observable. */
function fakeTx(outcomes: { id: string; order: number }[][]): {
  tx: TransactionSql;
  statements: string[];
} {
  const statements: string[] = [];
  let inserts = 0;
  const tag = (strings: TemplateStringsArray): Promise<unknown[]> => {
    const text = strings.join('?');
    statements.push(text);
    if (text.includes('INSERT INTO app.messages')) {
      const outcome = outcomes[inserts] ?? [];
      inserts += 1;
      return Promise.resolve(outcome);
    }
    return Promise.resolve([]);
  };
  Object.assign(tag, { json: (value: unknown) => value });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call and `json` are exercised
  return { tx: tag as unknown as TransactionSql, statements };
}

const ARGS = {
  threadId: 't-1',
  organizationId: 'org-1',
  role: 'user' as const,
  text: 'hello',
};

const insertsOf = (statements: string[]): number =>
  statements.filter((text) => text.includes('INSERT INTO app.messages')).length;

describe('saveMessage — claiming a unique slot', () => {
  it('claims the slot in one statement that reads max+1 and refuses a tie [THREAD-R1]', async () => {
    const { tx, statements } = fakeTx([[{ id: 'm-1', order: 4 }]]);
    await expect(saveMessage(tx, ARGS)).resolves.toEqual({
      messageId: 'm-1',
      order: 4,
    });
    const insert = statements.find((text) =>
      text.includes('INSERT INTO app.messages'),
    );
    expect(insert).toContain('coalesce(max("order"), -1) + 1');
    expect(insert).toContain(
      'ON CONFLICT (thread_id, "order", step_order) DO NOTHING',
    );
    // The thread's activity stamp follows a landed row.
    expect(statements.some((text) => text.includes('UPDATE app.threads'))).toBe(
      true,
    );
  });

  it('re-claims the next slot after a concurrent append took the computed one [THREAD-R1]', async () => {
    const { tx, statements } = fakeTx([[], [{ id: 'm-2', order: 5 }]]);
    await expect(saveMessage(tx, ARGS)).resolves.toEqual({
      messageId: 'm-2',
      order: 5,
    });
    expect(insertsOf(statements)).toBe(2);
  });

  it('outlasts a burst larger than any fixed count of lost races [THREAD-R1]', async () => {
    const lostRaces = Array.from({ length: 40 }, () => []);
    const { tx, statements } = fakeTx([
      ...lostRaces,
      [{ id: 'm-41', order: 40 }],
    ]);
    await expect(
      saveMessage(tx, ARGS, { sleep: () => Promise.resolve() }),
    ).resolves.toEqual({ messageId: 'm-41', order: 40 });
    expect(insertsOf(statements)).toBe(41);
  });

  it('lets an error from the claim through unchanged, after one insert', async () => {
    // A 40001 under SERIALIZABLE belongs to transactSerializable's rerun;
    // the claim must neither retry nor swallow it.
    const boom = Object.assign(new Error('could not serialize access'), {
      code: '40001',
    });
    const statements: string[] = [];
    const tag = (strings: TemplateStringsArray): Promise<unknown[]> => {
      statements.push(strings.join('?'));
      return Promise.reject(boom);
    };
    Object.assign(tag, { json: (value: unknown) => value });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call and `json` are exercised
    const tx = tag as unknown as TransactionSql;
    await expect(
      saveMessage(tx, ARGS, { sleep: () => Promise.resolve() }),
    ).rejects.toBe(boom);
    expect(insertsOf(statements)).toBe(1);
    expect(statements.some((text) => text.includes('UPDATE app.threads'))).toBe(
      false,
    );
  });

  it('gives up only when the deadline is spent [THREAD-R2]', async () => {
    const { tx, statements } = fakeTx([]);
    // Each clock read advances 4 s: the 10 s budget is gone at the third claim.
    let clock = 0;
    await expect(
      saveMessage(tx, ARGS, {
        now: () => (clock += 4_000),
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toThrow(
      `no free slot within ${MESSAGE_SLOT_CLAIM_DEADLINE_MS} ms (3 attempts)`,
    );
    expect(insertsOf(statements)).toBe(3);
    expect(statements.some((text) => text.includes('UPDATE app.threads'))).toBe(
      false,
    );
  });
});

describe('listThreadMessagesTail — the newest page and the way back', () => {
  /** A `sql` that answers every read with `rows` (newest first, as the
   * keyset orders them) and records the statement and its values; `unsafe`
   * hands its text through so the column list is observable. */
  function fakeSql(rows: { order: number; stepOrder: number }[]): {
    sql: Sql;
    calls: { text: string; values: unknown[] }[];
  } {
    const calls: { text: string; values: unknown[] }[] = [];
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join('?'), values });
      return Promise.resolve(rows);
    };
    Object.assign(tag, { unsafe: (text: string) => text });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call and `unsafe` are exercised
    return { sql: tag as unknown as Sql, calls };
  }

  const newestFirst = (count: number, from: number) =>
    Array.from({ length: count }, (_, index) => ({
      order: from - index,
      stepOrder: 0,
    }));

  it('answers the page oldest first and the cursor of its oldest row when more remain [THREAD-R3]', async () => {
    const { sql, calls } = fakeSql(newestFirst(4, 10));

    const page = await listThreadMessagesTail(sql, 't-1', { limit: 3 });

    expect(page.messages.map((row) => row.order)).toEqual([8, 9, 10]);
    expect(page.hasMore).toBe(true);
    expect(page.nextBefore).toEqual({ order: 8, stepOrder: 0 });
    // One row past the limit answers `hasMore` without a count.
    expect(calls[0]?.values.at(-1)).toBe(4);
  });

  it('answers no cursor once the start of the thread is in the page [THREAD-R3]', async () => {
    const { sql } = fakeSql(newestFirst(2, 1));

    const page = await listThreadMessagesTail(sql, 't-1', { limit: 3 });

    expect(page.messages.map((row) => row.order)).toEqual([0, 1]);
    expect(page.hasMore).toBe(false);
    expect(page.nextBefore).toBeNull();
  });

  it('keeps the task-comment read as it was: its own columns, no org clause, tool roles left out [THREAD-R4]', async () => {
    const { sql, calls } = fakeSql([]);

    await listThreadMessagesTail(sql, 't-1', {
      limit: 50,
      before: { order: 7, stepOrder: 0 },
    });

    const [call] = calls;
    expect(call?.values[0]).toContain('author_id AS "authorId"');
    expect(call?.text).toContain('OR org_id = ?');
    // [threadId, org clause off, its value, cursor off, order, step,
    //  tools clause off, limit + 1]
    expect(call?.values.slice(1)).toEqual([
      't-1',
      true,
      '',
      false,
      7,
      0,
      false,
      51,
    ]);
  });

  it('scopes the page to an organization, keeps every role and reads the named columns, 200 to a page [THREAD-R3] [THREAD-R4] [THREAD-R5]', async () => {
    const { sql, calls } = fakeSql([]);

    await listThreadMessagesTail(sql, 't-1', {
      organizationId: 'org-1',
      excludeToolRoles: false,
      columns: 'id, "order", step_order AS "stepOrder", model',
    });

    const [call] = calls;
    expect(call?.values).toEqual([
      'id, "order", step_order AS "stepOrder", model',
      't-1',
      false,
      'org-1',
      true,
      0,
      0,
      true,
      201,
    ]);
  });
});
