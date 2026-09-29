// @vitest-environment node

/**
 * `purgeDocument` is every hard-delete lane's funnel — the user delete, a
 * folder cascade, REST, the retention sweep, an erasure, a sync prune — and
 * the deleted document may have been its ref's HOLDER: the lowest-id active
 * document holding a shared ref, whose scope the corpus row carries. The
 * release keeps that ref for a twin, and a delete edits no scope, so the
 * row kept the deleted document's scope until the nightly reconcile counted
 * it as a failed sync. The purge now re-stamps the ref from its holder once
 * the row is gone — never before the delete commits, never for a purge the
 * release refused, and never for an organization whose corpus is gone.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { releaseRefs, syncRagRefHolderScopes, calls, state } = vi.hoisted(() => {
  const commits = { committed: 0 };
  const recorded: { refs: unknown[]; committedBefore: number }[] = [];
  return {
    state: commits,
    calls: recorded,
    releaseRefs: vi.fn(),
    syncRagRefHolderScopes: vi.fn(
      (_sql: unknown, _organizationId: string, refs: unknown[]) => {
        recorded.push({ refs: [...refs], committedBefore: commits.committed });
        return Promise.resolve();
      },
    ),
  };
});

vi.mock('../knowledge/release.ts', () => ({ releaseRefs }));
vi.mock('../knowledge/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../knowledge/service.ts')>()),
  syncRagRefHolderScopes,
}));
vi.mock('../knowledge_entries/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../knowledge_entries/service.ts')>()),
  markEntryChainDeletedForDocument: vi.fn(() => Promise.resolve()),
}));

const { purgeDocument, PurgeIncompleteError } = await import('./service.ts');

/** Records each statement; `begin` counts a commit once its body resolved. */
function fakeSql(): { sql: Sql; statements: string[] } {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray) => {
    statements.push(strings.join('?').replace(/\s+/g, ' ').trim());
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    begin: async (body: (tx: unknown) => Promise<unknown>) => {
      const result = await body(tag);
      state.committed += 1;
      return result;
    },
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { sql: sql as unknown as Sql, statements };
}

const DOC = { id: 'doc-1', fileRef: 's3:shared', organizationId: 'org-1' };

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  state.committed = 0;
  releaseRefs.mockResolvedValue({
    released: [],
    kept: ['s3:shared'],
    failures: [],
  });
});

describe('purgeDocument — the ref a twin keeps', () => {
  it('re-stamps it from its holder once the row is deleted and committed', async () => {
    const { sql, statements } = fakeSql();

    await purgeDocument(sql, 'acme', DOC);

    expect(statements).toContain('DELETE FROM app.documents WHERE id = ?');
    expect(calls).toEqual([{ refs: ['s3:shared'], committedBefore: 1 }]);
    expect(syncRagRefHolderScopes).toHaveBeenCalledWith(sql, 'org-1', [
      's3:shared',
    ]);
  });

  it('re-stamps nothing when the release failed and the row stays', async () => {
    releaseRefs.mockResolvedValue({
      released: [],
      kept: [],
      failures: [{ ref: 's3:shared', stage: 'corpus', message: 'down' }],
    });
    const { sql, statements } = fakeSql();

    await expect(purgeDocument(sql, 'acme', DOC)).rejects.toBeInstanceOf(
      PurgeIncompleteError,
    );

    expect(statements).toEqual([]);
    expect(syncRagRefHolderScopes).not.toHaveBeenCalled();
  });

  it('re-stamps nothing for an organization that is gone, or a document with no file', async () => {
    const { sql } = fakeSql();

    await purgeDocument(sql, null, DOC);
    await purgeDocument(sql, 'acme', { ...DOC, fileRef: null });

    expect(state.committed).toBe(2);
    expect(syncRagRefHolderScopes).not.toHaveBeenCalled();
  });
});
