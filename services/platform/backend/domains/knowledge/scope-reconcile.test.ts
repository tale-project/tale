// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the reconcile SENDS the corpus — the intended stamp for each document,
 * derived the same way the per-edit sync derives it. The `IS DISTINCT FROM`
 * guard that turns those into a drift count is SQL, so it belongs to the
 * integration harness; getting the derivation wrong here would re-stamp every
 * row on every run and report the whole corpus as drifted.
 */

const { getKnowledgePoolForOrg, folderTreePaths } = vi.hoisted(() => ({
  getKnowledgePoolForOrg: vi.fn(),
  folderTreePaths: vi.fn(),
}));

vi.mock('../../core/knowledge/pool.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/knowledge/pool.ts')>()),
  getKnowledgePoolForOrg,
}));

vi.mock('../folders/paths.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../folders/paths.ts')>()),
  folderTreePaths,
}));

const { reconcileDocumentScopeStamps } = await import('./service.ts');

interface DocRow {
  id: string;
  fileRef: string;
  teamId: string | null;
  teamTags: string[];
  projectId: string | null;
  folderId: string | null;
  folderPath: string | null;
}

/**
 * `sql` is only ever the document read here — answered the way the keyset
 * page reads it: the rows after the `afterId` parameter in id order, at most
 * the `LIMIT` parameter of them. The parameters are the tagged template's
 * values, in the order the statement binds them.
 */
interface PageRead {
  afterId: string | null;
  limit: number;
}

function fakeSql(rows: DocRow[]): Sql & { reads: PageRead[] } {
  const reads: PageRead[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    // `strings[i]` precedes `values[i]`: the cursor is the value right
    // before the `::text IS NULL` guard, the page size is the LIMIT value.
    const guard = strings.findIndex((part) => part.includes('::text IS NULL'));
    const afterId = values[guard - 1];
    const limit = values.at(-1);
    reads.push({
      afterId: typeof afterId === 'string' ? afterId : null,
      limit: typeof limit === 'number' ? limit : Number.NaN,
    });
    const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
    const page = sorted
      .filter((row) => typeof afterId !== 'string' || row.id > afterId)
      .slice(0, typeof limit === 'number' ? limit : rows.length);
    return Promise.resolve(page);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reconcile only ever issues this one tagged read
  return Object.assign(sql, { reads }) as unknown as Sql & {
    reads: PageRead[];
  };
}

/** What postgres.js's `sql.json()` hands back: a typed parameter. */
interface JsonParameter {
  type: 3802;
  value: unknown;
}

/** The corpus pool: records the payload, answers with a row count. */
function fakePool(count: number) {
  const sent: unknown[][] = [];
  return {
    sent,
    pool: {
      json: (value: unknown): JsonParameter => ({ type: 3802, value }),
      unsafe: (_sql: string, params: unknown[]) => {
        sent.push(params);
        return Promise.resolve({ count });
      },
    },
  };
}

/** The single jsonb payload the reconcile builds. */
function payloadOf(sent: unknown[][]) {
  const param = sent[0]?.[1] as JsonParameter;
  return param.value as Array<Record<string, unknown>>;
}

const doc = (over: Partial<DocRow> = {}): DocRow => ({
  id: 'doc-1',
  fileRef: 'blob:f1',
  teamId: null,
  teamTags: [],
  projectId: null,
  folderId: null,
  folderPath: null,
  ...over,
});

describe('reconcileDocumentScopeStamps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    folderTreePaths.mockResolvedValue(new Map<string, string>());
  });

  it('does not touch the corpus when the org has no documents', async () => {
    const { pool, sent } = fakePool(0);
    getKnowledgePoolForOrg.mockResolvedValue(pool);

    const out = await reconcileDocumentScopeStamps(fakeSql([]), {
      organizationId: 'org-1',
      orgSlug: 'acme',
    });

    expect(out).toEqual({ scanned: 0, corrected: 0 });
    expect(sent).toEqual([]);
    expect(getKnowledgePoolForOrg).not.toHaveBeenCalled();
  });

  it('reports the corpus row count as the drift count', async () => {
    const { pool } = fakePool(2);
    getKnowledgePoolForOrg.mockResolvedValue(pool);

    const out = await reconcileDocumentScopeStamps(
      fakeSql([
        doc(),
        doc({ id: 'doc-2', fileRef: 'blob:f2' }),
        doc({ id: 'doc-3', fileRef: 'blob:f3' }),
      ]),
      { organizationId: 'org-1', orgSlug: 'acme' },
    );

    // Three compared, two actually differed — the guard is what makes the
    // count meaningful, so the reconcile must not report `scanned` as drift.
    expect(out).toEqual({ scanned: 3, corrected: 2 });
  });

  it('sends the rows as one jsonb parameter, never as a pre-serialized string', async () => {
    const { pool, sent } = fakePool(1);
    getKnowledgePoolForOrg.mockResolvedValue(pool);

    await reconcileDocumentScopeStamps(fakeSql([doc()]), {
      organizationId: 'org-1',
      orgSlug: 'acme',
    });

    // postgres.js JSON-encodes a jsonb-typed parameter itself; a string here
    // would arrive double-encoded and `jsonb_to_recordset` would refuse it
    // ("cannot call jsonb_to_recordset on a non-array") — the defect that
    // truncated the integration proof at the reconcile lane.
    const param = sent[0]?.[1] as JsonParameter;
    expect(typeof param).toBe('object');
    expect(param.type).toBe(3802);
    expect(Array.isArray(param.value)).toBe(true);
  });

  it('stamps a hub document with NULL rather than an empty array', async () => {
    const { pool, sent } = fakePool(1);
    getKnowledgePoolForOrg.mockResolvedValue(pool);

    await reconcileDocumentScopeStamps(fakeSql([doc()]), {
      organizationId: 'org-1',
      orgSlug: 'acme',
    });

    // An empty array is NOT the hub shape — the pre-filter's hub clause is
    // `team_ids IS NULL`, so `{}` would hide the row from everyone.
    expect(payloadOf(sent)[0]).toEqual({
      file_id: 'blob:f1',
      team_ids: null,
      team_id: null,
      project_id: null,
      folder_path: null,
    });
  });

  it('prefers the tag array over the deprecated single column', async () => {
    const { pool, sent } = fakePool(1);
    getKnowledgePoolForOrg.mockResolvedValue(pool);

    await reconcileDocumentScopeStamps(
      fakeSql([doc({ teamTags: ['t1', 't2'], teamId: 'stale' })]),
      { organizationId: 'org-1', orgSlug: 'acme' },
    );

    const [row] = payloadOf(sent);
    expect(row?.team_ids).toEqual(['t1', 't2']);
    // The mirror is the FIRST tag, not the stale column it replaced.
    expect(row?.team_id).toBe('t1');
  });

  it('falls back to the single column when no tags are stamped', async () => {
    const { pool, sent } = fakePool(1);
    getKnowledgePoolForOrg.mockResolvedValue(pool);

    await reconcileDocumentScopeStamps(
      fakeSql([doc({ teamTags: [], teamId: 't9' })]),
      { organizationId: 'org-1', orgSlug: 'acme' },
    );

    const [row] = payloadOf(sent);
    expect(row?.team_ids).toEqual(['t9']);
    expect(row?.team_id).toBe('t9');
  });

  it('takes the folder path from the tree, not the copy on the row', async () => {
    const { pool, sent } = fakePool(1);
    getKnowledgePoolForOrg.mockResolvedValue(pool);
    // The row's own `folder_path` is a copy that lags a folder move; the tree
    // is the truth, which is the whole reason a moved folder drifts.
    folderTreePaths.mockResolvedValue(new Map([['fold-1', 'Reports/2026']]));

    await reconcileDocumentScopeStamps(
      fakeSql([doc({ folderId: 'fold-1', folderPath: 'Reports/stale' })]),
      { organizationId: 'org-1', orgSlug: 'acme' },
    );

    expect(payloadOf(sent)[0]?.folder_path).toBe('Reports/2026');
  });

  it('normalizes the stamp so spelling never decides a match', async () => {
    const { pool, sent } = fakePool(1);
    getKnowledgePoolForOrg.mockResolvedValue(pool);
    // The WebDAV lane stores the 0.4 `'/A/B'` spelling and the folder tree
    // produces `'A/B'`. Stamping the raw value would make the reconcile
    // rewrite the same row on every run and report the corpus as drifted
    // forever.
    folderTreePaths.mockResolvedValue(new Map([['fold-1', '/Reports/2026/']]));

    await reconcileDocumentScopeStamps(fakeSql([doc({ folderId: 'fold-1' })]), {
      organizationId: 'org-1',
      orgSlug: 'acme',
    });

    expect(payloadOf(sent)[0]?.folder_path).toBe('Reports/2026');
  });

  it('stamps the root as null, not an empty string', async () => {
    const { pool, sent } = fakePool(1);
    getKnowledgePoolForOrg.mockResolvedValue(pool);

    await reconcileDocumentScopeStamps(
      fakeSql([doc({ folderId: null, folderPath: '/' })]),
      { organizationId: 'org-1', orgSlug: 'acme' },
    );

    expect(payloadOf(sent)[0]?.folder_path).toBeNull();
  });

  it('walks the whole corpus in keyset pages, not a fixed first page', async () => {
    // Seven live documents, pages of three: a fixed `LIMIT` with no cursor
    // re-checked the same three every run and never reached the other four,
    // so their drift was never corrected — and the report under-counted.
    const rows = Array.from({ length: 7 }, (_, index) =>
      doc({ id: `doc-${index + 1}`, fileRef: `blob:f${index + 1}` }),
    );
    const sql = fakeSql(rows);
    const { pool, sent } = fakePool(1);
    getKnowledgePoolForOrg.mockResolvedValue(pool);

    const out = await reconcileDocumentScopeStamps(sql, {
      organizationId: 'org-1',
      orgSlug: 'acme',
      limit: 3,
    });

    // Every document was compared exactly once, across three pages.
    expect(out).toEqual({ scanned: 7, corrected: 3 });
    expect(sent.flatMap((params) => payloadOf([params]))).toHaveLength(7);
    expect(
      sent.flatMap((params) => payloadOf([params]).map((row) => row.file_id)),
    ).toEqual(rows.map((row) => row.fileRef));
    // Each read starts after the previous page's last id; the walk stops on
    // the first short page rather than issuing an empty fourth read.
    expect(sql.reads).toEqual([
      { afterId: null, limit: 3 },
      { afterId: 'doc-3', limit: 3 },
      { afterId: 'doc-6', limit: 3 },
    ]);
  });

  it('issues one more read when the corpus ends exactly on a page boundary', async () => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      doc({ id: `doc-${index + 1}`, fileRef: `blob:f${index + 1}` }),
    );
    const sql = fakeSql(rows);
    const { pool, sent } = fakePool(0);
    getKnowledgePoolForOrg.mockResolvedValue(pool);

    const out = await reconcileDocumentScopeStamps(sql, {
      organizationId: 'org-1',
      orgSlug: 'acme',
      limit: 3,
    });

    // A full last page cannot know it is last; the empty read after it is
    // what ends the walk — and it must not reach the corpus.
    expect(out).toEqual({ scanned: 6, corrected: 0 });
    expect(sent).toHaveLength(2);
    expect(sql.reads.map((read) => read.afterId)).toEqual([
      null,
      'doc-3',
      'doc-6',
    ]);
  });

  it('sends the org slug the corpus rows are keyed by', async () => {
    const { pool, sent } = fakePool(0);
    getKnowledgePoolForOrg.mockResolvedValue(pool);

    await reconcileDocumentScopeStamps(fakeSql([doc()]), {
      organizationId: 'org-1',
      orgSlug: 'acme',
    });

    expect(sent[0]?.[0]).toBe('acme');
    expect(getKnowledgePoolForOrg).toHaveBeenCalledWith('acme');
  });
});
