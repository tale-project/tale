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
 * A replaced blob's ref may still be held by a twin (a WebDAV copy of the
 * synced file), which is its holder now: its corpus row is re-stamped.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { MAX_UPLOAD_BYTES } from '../files/bounded-body.ts';
import { putOrgBlobBytes } from '../files/service.ts';
import { syncRagRefHolderScopes } from '../knowledge/service.ts';
import { createSyncImportDeps, ONEDRIVE_SYNC_ADAPTER } from './service.ts';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../files/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../files/service.ts')>()),
  putOrgBlobBytes: vi.fn(async () => 'blob-pdf'),
}));
vi.mock('../knowledge/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../knowledge/service.ts')>()),
  syncRagRefHolderScopes: vi.fn(() => Promise.resolve()),
}));

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
    expect(syncRagRefHolderScopes).toHaveBeenCalledWith(sql, 'org-1', [
      'blob-old',
    ]);
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
    expect(syncRagRefHolderScopes).not.toHaveBeenCalled();
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

/**
 * What a failed vendor download tells the import: a refused token (401) is
 * the cue to refresh the grant, and a file past the size cap is refused in
 * the upload door's own words, which the import's toast may show. Any other
 * failure — the provider's answer, an outage — is a fault, its text for the
 * log alone.
 */
describe('createSyncImportDeps.downloadToStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const download = (response: Response) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    );
    const deps = createSyncImportDeps(
      fakeSql().sql,
      ONEDRIVE_SYNC_ADAPTER,
      'org-1',
    );
    return deps.downloadToStorage({ itemId: 'item-1', token: 'tok' });
  };

  it('flags a download Graph refused the token for', async () => {
    const stored = await download(
      new Response('{"error":{"code":"InvalidAuthenticationToken"}}', {
        status: 401,
      }),
    );

    expect(stored).toMatchObject({ success: false, unauthorized: true });
    expect(stored.refusal).toBeUndefined();
  });

  it('refuses a file past the size cap in words a person can read', async () => {
    const stored = await download(
      new Response('bytes', {
        status: 200,
        headers: { 'content-length': String(MAX_UPLOAD_BYTES + 1) },
      }),
    );

    expect(stored.success).toBe(false);
    expect(stored.refusal).toEqual({
      code: 'FILE_SIZE_INVALID',
      message: expect.stringMatching(/^The file is \d+ bytes; the limit is /),
    });
    expect(stored.unauthorized).toBeUndefined();
  });

  it("keeps a provider's answer a fault", async () => {
    const stored = await download(
      new Response('{"error":{"code":"serviceNotAvailable"}}', {
        status: 503,
      }),
    );

    expect(stored).toMatchObject({
      success: false,
      error: expect.stringContaining('503'),
    });
    expect(stored.unauthorized).toBeUndefined();
    expect(stored.refusal).toBeUndefined();
  });
});

/**
 * A Loop page asked for as a PDF (ODRIVE-R10): Graph's own conversion on the
 * same `/content` door. An answer asking again will not change — a 4xx that
 * is no token refusal, timeout or rate limit, or bytes that are no PDF —
 * says the item is not convertible, and nothing is stored; the import then
 * keeps the page as it is. Any other failure stays what it was.
 */
describe('createSyncImportDeps.downloadToStorage with a format', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const PDF = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n';

  const convert = (
    response: Response,
    drive: { siteId?: string; driveId?: string } = {},
  ) => {
    const fetchMock = vi.fn(async () => response);
    vi.stubGlobal('fetch', fetchMock);
    const deps = createSyncImportDeps(
      fakeSql().sql,
      ONEDRIVE_SYNC_ADAPTER,
      'org-1',
    );
    return {
      fetchMock,
      stored: deps.downloadToStorage({
        itemId: 'item-1',
        token: 'tok',
        format: 'pdf',
        ...drive,
      }),
    };
  };

  it.each([
    [
      {},
      'https://graph.microsoft.com/v1.0/me/drive/items/item-1/content?format=pdf',
    ],
    [
      { siteId: 'site-1', driveId: 'drive-1' },
      'https://graph.microsoft.com/v1.0/sites/site-1/drives/drive-1/items/item-1/content?format=pdf',
    ],
  ])(
    'stores the PDF Graph makes of the item, as a PDF whatever it is called (%o)',
    async (drive, url) => {
      const { fetchMock, stored } = convert(
        new Response(PDF, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
        drive,
      );

      expect(await stored).toEqual({
        success: true,
        storageId: 'blob-pdf',
        mimeType: 'application/pdf',
        size: new TextEncoder().encode(PDF).byteLength,
      });
      expect(fetchMock).toHaveBeenCalledWith(url, expect.anything());
      expect(putOrgBlobBytes).toHaveBeenCalledWith(expect.anything(), 'org-1', {
        bytes: expect.any(Uint8Array),
        contentType: 'application/pdf',
      });
    },
  );

  it.each([400, 403, 404, 406, 415])(
    'reads a %i as an item Graph does not convert, storing nothing',
    async (status) => {
      const { stored } = convert(
        new Response('{"error":{"code":"notSupported"}}', { status }),
      );

      expect(await stored).toMatchObject({
        success: false,
        notConvertible: true,
        error: expect.stringContaining(String(status)),
      });
      expect(putOrgBlobBytes).not.toHaveBeenCalled();
    },
  );

  it.each([401, 408, 429, 503])(
    'keeps a %i what it is: no answer about the item',
    async (status) => {
      const { stored } = convert(
        new Response('{"error":{"code":"x"}}', { status }),
      );

      const answer = await stored;
      expect(answer.success).toBe(false);
      expect(answer.notConvertible).toBeUndefined();
      expect(answer.unauthorized).toBe(status === 401 ? true : undefined);
    },
  );

  it.each([
    ['an empty body', ''],
    ['a sign-in page', '<html><body>Sign in</body></html>'],
  ])('stores no PDF that is %s', async (_body, text) => {
    const { stored } = convert(
      new Response(text, {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
    );

    expect(await stored).toMatchObject({
      success: false,
      notConvertible: true,
    });
    expect(putOrgBlobBytes).not.toHaveBeenCalled();
  });

  it('asks for the item itself when no format is asked, and keeps a 4xx a fault', async () => {
    const fetchMock = vi.fn(
      async () => new Response('{"error":{"code":"x"}}', { status: 406 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const deps = createSyncImportDeps(
      fakeSql().sql,
      ONEDRIVE_SYNC_ADAPTER,
      'org-1',
    );

    const stored = await deps.downloadToStorage({
      itemId: 'item-1',
      token: 'tok',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/drive/items/item-1/content',
      expect.anything(),
    );
    expect(stored.success).toBe(false);
    expect(stored.notConvertible).toBeUndefined();
  });
});
