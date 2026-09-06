// @vitest-environment node

/**
 * The pg import deps' blob bookkeeping. A replaced blob must ALWAYS land
 * the previous ref in `history_files` and release its corpus rows — keyed
 * on the ref, never on the content hash: a vendor file without a hash used
 * to swap `file_ref` with no bookkeeping (a stranded blob, file row and
 * duplicate chunk set per scan, reclaimed by nothing). And the loser of a
 * createDocument race used to get the winner's id back over a blob the
 * document never referenced — it now refreshes the row through the same
 * lane, so its blob becomes `file_ref` and the winner's joins the history.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { createSyncImportDeps, ONEDRIVE_SYNC_ADAPTER } from './service.ts';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));

interface Statement {
  text: string;
  values: unknown[];
}

const DOC = {
  id: 'doc-1',
  externalItemId: 'item-1',
  fileRef: 'blob-old',
  folderId: null,
  projectId: null,
  historyFiles: [] as string[],
  contentHash: null,
  metadata: {},
};

function fakeSql(opts: { insertConflicts?: boolean } = {}): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$');
    statements.push({ text, values });
    if (text.includes('INSERT INTO app.documents')) {
      return Promise.resolve(opts.insertConflicts ? [] : [{ id: 'doc-new' }]);
    }
    if (
      text.includes('SELECT id FROM app.documents') &&
      text.includes('external_item_id = $')
    ) {
      return Promise.resolve([{ id: DOC.id }]);
    }
    if (text.includes('FROM app.documents') && text.includes('WHERE id = $')) {
      return Promise.resolve([DOC]);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    unsafe: (t: string) => t,
    json: (v: unknown) => v,
    begin: (fn: (tx: unknown) => Promise<void>) => fn(tag),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, statements };
}

const updateStatement = (statements: Statement[]): Statement | undefined =>
  statements.find((s) => s.text.includes('UPDATE app.documents SET'));

afterEach(() => {
  vi.clearAllMocks();
});

describe('createSyncImportDeps.updateDocument', () => {
  it('moves the previous blob to history and releases its corpus rows even without a hash', async () => {
    const { sql, statements } = fakeSql();
    const deps = createSyncImportDeps(sql, ONEDRIVE_SYNC_ADAPTER, 'org-1');

    await deps.updateDocument({
      documentId: 'doc-1',
      title: 'a.txt',
      fileId: 'blob-new',
      sourceProvider: 'onedrive',
      externalItemId: 'item-1',
      // The vendor sent no hash.
      contentHash: undefined,
    });

    const update = updateStatement(statements);
    expect(update).toBeDefined();
    expect(update?.values).toContain('blob-new');
    expect(update?.values).toContainEqual(['blob-old']);
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'knowledge.release_refs',
      { organizationId: 'org-1', refs: ['blob-old'] },
    );
  });

  it('keeps history and corpus untouched when the blob is the same', async () => {
    const { sql, statements } = fakeSql();
    const deps = createSyncImportDeps(sql, ONEDRIVE_SYNC_ADAPTER, 'org-1');

    await deps.updateDocument({
      documentId: 'doc-1',
      title: 'a.txt',
      fileId: 'blob-old',
      sourceProvider: 'onedrive',
      externalItemId: 'item-1',
    });

    expect(updateStatement(statements)?.values).toContainEqual([]);
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});

describe('createSyncImportDeps.createDocument', () => {
  it('returns the fresh id when the insert lands', async () => {
    const { sql, statements } = fakeSql();
    const deps = createSyncImportDeps(sql, ONEDRIVE_SYNC_ADAPTER, 'org-1');

    const id = await deps.createDocument({
      organizationId: 'org-1',
      title: 'a.txt',
      fileId: 'blob-new',
      sourceProvider: 'onedrive',
      externalItemId: 'item-1',
    });

    expect(id).toBe('doc-new');
    expect(updateStatement(statements)).toBeUndefined();
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('refreshes the winner row with the loser blob when the insert loses the race', async () => {
    const { sql, statements } = fakeSql({ insertConflicts: true });
    const deps = createSyncImportDeps(sql, ONEDRIVE_SYNC_ADAPTER, 'org-1');

    const id = await deps.createDocument({
      organizationId: 'org-1',
      title: 'a.txt',
      fileId: 'blob-loser',
      mimeType: 'text/plain',
      sourceProvider: 'onedrive',
      externalItemId: 'item-1',
      contentHash: 'h1',
      metadata: { oneDriveItemId: 'item-1' },
    });

    expect(id).toBe('doc-1');
    const update = updateStatement(statements);
    expect(update).toBeDefined();
    // The loser's blob is the document's blob now — the pipeline's file row
    // and RAG schedule that follow point at a blob the document references.
    expect(update?.values).toContain('blob-loser');
    expect(update?.values).toContain('h1');
    // …and the winner's blob is bookkept, not dropped.
    expect(update?.values).toContainEqual(['blob-old']);
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'knowledge.release_refs',
      { organizationId: 'org-1', refs: ['blob-old'] },
    );
  });
});
