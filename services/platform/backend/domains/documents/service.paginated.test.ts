// @vitest-environment node

/**
 * The hub page (`GET /documents/paginated`, the Documents table's infinite
 * listing) is ONE folder of the hub. Its first Postgres port read a missing
 * `folderId` as "no filter": the root — asked for with no folder — listed
 * every hub document beside its own folder, so a synced OneDrive folder's
 * files stood at the root AND inside the folder, and deleting the folder made
 * the "root copies" vanish with it (one row rendered twice, 2026-09-14). The
 * 0.4 index read matched `folderId` equal to `undefined`, i.e. the unfiled
 * rows. This pins that contract on the SQL: the root binds `NULL` through
 * `IS NOT DISTINCT FROM`, a folder binds its id, and no argument shape means
 * "the whole hub".
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { listHubDocumentsPaginated } from './service.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function pageRow(i: number) {
  return { id: `doc-${i}`, createdAt: 1_000 - i };
}

/** Records every statement; answers rows to the SELECT and a marker to the
 * access-clause fragment the SELECT embeds. */
function fakeSql(rows: ReturnType<typeof pageRow>[]): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    if (!text.startsWith('SELECT')) return { fragment: text };
    statements.push({ text, values });
    const limit = values[values.length - 1];
    return Promise.resolve(
      typeof limit === 'number' ? rows.slice(0, limit) : rows,
    );
  };
  const sql = Object.assign(run, {
    unsafe: (text: string) => text,
  }) as unknown as Sql;
  return { sql, statements };
}

const auth = {
  organizationId: 'org_1',
  userId: 'user-1',
  role: 'member',
  teamIds: [] as string[],
};

const FOLDER_CLAUSE = 'folder_id IS NOT DISTINCT FROM ?';

/** The value bound to the folder clause's placeholder. */
function boundFolder(statement: Statement): unknown {
  const at = statement.text.indexOf(FOLDER_CLAUSE);
  expect(at).toBeGreaterThan(-1);
  const placeholdersBefore = statement.text.slice(0, at).split('?').length - 1;
  return statement.values[placeholdersBefore];
}

describe('listHubDocumentsPaginated', () => {
  it('lists the root as the documents in no folder, never the whole hub', async () => {
    const { sql, statements } = fakeSql([pageRow(0), pageRow(1)]);
    const page = await listHubDocumentsPaginated(sql, auth, {
      cursor: null,
      numItems: 20,
      folderId: null,
    });
    const statement = statements[0];
    expect(statement).toBeDefined();
    if (!statement) return;
    expect(boundFolder(statement)).toBeNull();
    // The old shape — `(? IS NULL OR folder_id = ?)` — made a NULL folder
    // match every row; a NULL must select the unfiled rows and nothing else.
    expect(statement.text).not.toContain('IS NULL OR folder_id');
    expect(page.page.map((row) => row.id)).toEqual(['doc-0', 'doc-1']);
    expect(page.isDone).toBe(true);
  });

  it('lists one folder by its id', async () => {
    const { sql, statements } = fakeSql([pageRow(0)]);
    await listHubDocumentsPaginated(sql, auth, {
      cursor: null,
      numItems: 20,
      folderId: 'folder-meetings',
    });
    const statement = statements[0];
    expect(statement).toBeDefined();
    if (!statement) return;
    expect(boundFolder(statement)).toBe('folder-meetings');
  });

  it('reads one row past the page and hands back a cursor when more remain', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => pageRow(i));
    const { sql, statements } = fakeSql(rows);
    const page = await listHubDocumentsPaginated(sql, auth, {
      cursor: null,
      numItems: 2,
      folderId: null,
    });
    expect(statements[0]?.values.at(-1)).toBe(3);
    expect(page.page.map((row) => row.id)).toEqual(['doc-0', 'doc-1']);
    expect(page.isDone).toBe(false);
    expect(page.continueCursor).not.toBe('');
  });
});
