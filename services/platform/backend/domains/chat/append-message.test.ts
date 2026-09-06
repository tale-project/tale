// @vitest-environment node

/**
 * The chat appender claims its (order, step) slot the same way the generic
 * store does: one statement that reads max+1 and is refused by the unique
 * slot index when a concurrent turn got there first — after which it claims
 * the next slot, so two racing sends never tie a thread's ordering.
 */

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/org-config.ts', () => ({ resolveOrgSlug: vi.fn() }));
vi.mock('../../core/lib/providers/org_providers.ts', () => ({
  resolveProvidersForOrg: vi.fn(),
}));
vi.mock('../../core/lib/providers/catalog_fetch.ts', () => ({
  getProviderCatalog: vi.fn(),
}));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));

import { MESSAGE_SLOT_CLAIM_DEADLINE_MS } from '../threads/store.ts';
import { appendMessageRow } from './store.ts';

/** A `sql` whose INSERTs answer from `outcomes` in order (an empty array is a
 * lost race); every other statement finds nothing. */
function fakeSql(outcomes: { id: string; order: number }[][]): {
  sql: Sql;
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
  return { sql: tag as unknown as Sql, statements };
}

const MESSAGE = {
  organizationId: 'org-1',
  threadId: 't-1',
  role: 'assistant',
  parts: [],
  status: 'pending',
};

const insertsOf = (statements: string[]): number =>
  statements.filter((text) => text.includes('INSERT INTO app.messages')).length;

describe('appendMessageRow — claiming a unique slot', () => {
  it('lands on the computed slot when nobody raced it', async () => {
    const { sql, statements } = fakeSql([[{ id: 'm-1', order: 7 }]]);
    await expect(appendMessageRow(sql, MESSAGE)).resolves.toEqual({
      id: 'm-1',
      sequence: 7,
    });
    expect(insertsOf(statements)).toBe(1);
    expect(statements[0]).toContain(
      'ON CONFLICT (thread_id, "order", step_order) DO NOTHING',
    );
  });

  it('re-claims the next slot after losing the race for one', async () => {
    const { sql, statements } = fakeSql([[], [], [{ id: 'm-3', order: 9 }]]);
    await expect(appendMessageRow(sql, MESSAGE)).resolves.toEqual({
      id: 'm-3',
      sequence: 9,
    });
    expect(insertsOf(statements)).toBe(3);
  });

  it('keeps re-claiming through a burst larger than any fixed count', async () => {
    const lostRaces = Array.from({ length: 40 }, () => []);
    const { sql, statements } = fakeSql([
      ...lostRaces,
      [{ id: 'm-41', order: 40 }],
    ]);
    const pauses: number[] = [];
    await expect(
      appendMessageRow(sql, MESSAGE, {
        sleep: (ms) => {
          pauses.push(ms);
          return Promise.resolve();
        },
      }),
    ).resolves.toEqual({ id: 'm-41', sequence: 40 });
    expect(insertsOf(statements)).toBe(41);
    // One jittered pause per lost race, never longer than the cap.
    expect(pauses).toHaveLength(40);
    expect(Math.max(...pauses)).toBeLessThanOrEqual(75);
  });

  it('fails loudly, and writes nothing else, once the deadline is spent', async () => {
    const { sql, statements } = fakeSql([]);
    // Each clock read advances 4 s: the 10 s budget is gone at the third claim.
    let clock = 0;
    await expect(
      appendMessageRow(sql, MESSAGE, {
        now: () => (clock += 4_000),
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toThrow(
      `no free slot within ${MESSAGE_SLOT_CLAIM_DEADLINE_MS} ms (3 attempts)`,
    );
    expect(insertsOf(statements)).toBe(3);
    expect(statements.some((text) => text.includes('UPDATE'))).toBe(false);
  });
});
