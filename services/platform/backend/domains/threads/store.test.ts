// @vitest-environment node

/**
 * A message slot is unique: an append that loses the race for `max+1` gets
 * no row back from `ON CONFLICT DO NOTHING` and must claim the next slot on
 * a fresh statement — never land on the winner's slot, never surface the
 * lost race as an error while the deadline remains.
 */

import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { MESSAGE_SLOT_CLAIM_DEADLINE_MS, saveMessage } from './store.ts';

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
  it('claims the slot in one statement that reads max+1 and refuses a tie', async () => {
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

  it('re-claims the next slot after a concurrent append took the computed one', async () => {
    const { tx, statements } = fakeTx([[], [{ id: 'm-2', order: 5 }]]);
    await expect(saveMessage(tx, ARGS)).resolves.toEqual({
      messageId: 'm-2',
      order: 5,
    });
    expect(insertsOf(statements)).toBe(2);
  });

  it('outlasts a burst larger than any fixed count of lost races', async () => {
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

  it('gives up only when the deadline is spent', async () => {
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
