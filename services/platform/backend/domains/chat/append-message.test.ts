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

import { MESSAGE_SLOT_ATTEMPTS } from '../threads/store.ts';
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

  it('fails loudly, and writes nothing else, once the attempts are spent', async () => {
    const { sql, statements } = fakeSql([]);
    await expect(appendMessageRow(sql, MESSAGE)).rejects.toThrow(
      /no free slot/,
    );
    expect(insertsOf(statements)).toBe(MESSAGE_SLOT_ATTEMPTS);
    expect(statements.some((text) => text.includes('UPDATE'))).toBe(false);
  });
});
