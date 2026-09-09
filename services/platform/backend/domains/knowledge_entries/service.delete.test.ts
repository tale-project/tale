// @vitest-environment node

/**
 * A knowledge entry is deleted once. The regression under test: the delete
 * looked the row up without its `deleted_at_ms IS NULL` guard, so a second
 * DELETE found the soft-deleted row, re-ran an UPDATE that matched nothing,
 * and answered 204 where the API reference promises 404.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { deleteKnowledgeEntry, KnowledgeEntryError } from './service.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(lookup: unknown[]): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT topic_key')) return Promise.resolve(lookup);
    return Promise.resolve([]);
  };
  const sql = {
    begin: (callback: (handle: typeof tx) => Promise<unknown>) => callback(tx),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, statements };
}

const args = { organizationId: 'org-1', entryId: 'k-1', role: 'admin' };

describe('deleteKnowledgeEntry', () => {
  it('looks only at live rows, and answers 404 for one already deleted', async () => {
    const fake = fakeSql([]);
    let caught: unknown;
    try {
      await deleteKnowledgeEntry(fake.sql, args);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KnowledgeEntryError);
    expect(caught).toMatchObject({
      code: 'KNOWLEDGE_ENTRY_NOT_FOUND',
      status: 404,
    });
    expect(fake.statements[0]?.text).toContain('deleted_at_ms IS NULL');
    expect(fake.statements.some((s) => s.text.startsWith('UPDATE'))).toBe(
      false,
    );
  });

  it('soft-deletes the live chain', async () => {
    const fake = fakeSql([{ topicKey: 'refunds', documentId: null }]);
    await deleteKnowledgeEntry(fake.sql, args);
    expect(
      fake.statements.some((s) =>
        s.text.startsWith('UPDATE app.knowledge_entries'),
      ),
    ).toBe(true);
  });
});
