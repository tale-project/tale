// @vitest-environment node

import { createHash } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

/**
 * The entry write path around its two seams: the blob store it uploads to
 * BEFORE the transaction, and the document + file rows it materializes
 * inside it. What is pinned is state the rest of the platform reads —
 * the file row's indexing state (the document list and the indexing
 * watchdog both branch on it), the release of a rotated blob, and the
 * gate on a backing document that is no longer active.
 */

const { addJobInTx, markRagQueued, resolveOrgSlug, store } = vi.hoisted(() => ({
  addJobInTx: vi.fn(),
  markRagQueued: vi.fn(),
  resolveOrgSlug: vi.fn(),
  store: {
    resolveObjectStore: vi.fn(),
    buildObjectKey: vi.fn(),
    s3PresignPutUrl: vi.fn(),
  },
}));

vi.mock('../../jobs/enqueue.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../jobs/enqueue.ts')>()),
  addJobInTx,
}));
vi.mock('../knowledge/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../knowledge/service.ts')>()),
  markRagQueued,
}));
vi.mock('../../lib/org-config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/org-config.ts')>()),
  resolveOrgSlug,
}));
vi.mock('../../lib/object-store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/object-store.ts')>()),
  ...store,
}));

const {
  createKnowledgeEntry,
  updateKnowledgeEntry,
  markEntryChainDeletedForDocument,
  markEntryChainsDeletedForDocuments,
  KnowledgeEntryError,
} = await import('./service.ts');

interface Statement {
  text: string;
  values: unknown[];
}

interface Script {
  /** The entry `updateKnowledgeEntry` loads (with its document); active
   * unless the script says otherwise. */
  current?: {
    id: string;
    topicKey: string;
    documentId: string | null;
    status?: string;
    supersededBy?: string | null;
  };
  /** The blob ref the file row carried before a rotation. */
  previousRef?: string;
}

/** A transaction double answering the writes the entry path issues, in
 * the shape each `RETURNING` expects, and recording every statement. */
function fakeSql(script: Script): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes('INSERT INTO app.knowledge_entries')) {
      return Promise.resolve([{ id: 'entry-new' }]);
    }
    if (text.includes('INSERT INTO app.file_metadata')) {
      return Promise.resolve([{ id: 'file-1' }]);
    }
    if (text.includes('INSERT INTO app.documents')) {
      return Promise.resolve([{ id: 'doc-1' }]);
    }
    if (
      text.includes('UPDATE app.file_metadata') &&
      text.includes('RETURNING')
    ) {
      return Promise.resolve([{ id: 'file-1' }]);
    }
    if (text.includes('SELECT storage_ref')) {
      return Promise.resolve(
        script.previousRef !== undefined
          ? [{ storageRef: script.previousRef }]
          : [],
      );
    }
    if (text.includes('LEFT JOIN app.documents')) {
      return Promise.resolve(
        script.current
          ? [{ status: 'active', supersededBy: null, ...script.current }]
          : [],
      );
    }
    if (text.includes('UPDATE app.knowledge_entries SET deleted_at_ms')) {
      return Promise.resolve(Object.assign([], { count: 3 }));
    }
    // `findActiveByTopicKey`: no clash.
    return Promise.resolve([]);
  };
  const sql = Object.assign(tx, {
    json: (value: unknown) => value,
    begin: (fn: (tx: TransactionSql) => Promise<unknown>) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the double is the transaction
      fn(tx as unknown as TransactionSql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal Sql facade for the entry path
  return { sql: sql as unknown as Sql, statements };
}

const ORG = 'org-1';
const WRITER = { organizationId: ORG, userId: 'u-1', role: 'admin' };

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  vi.clearAllMocks();
  addJobInTx.mockResolvedValue(undefined);
  markRagQueued.mockResolvedValue(undefined);
  resolveOrgSlug.mockResolvedValue('acme');
  store.resolveObjectStore.mockResolvedValue({ bucket: 'b' });
  store.buildObjectKey.mockReturnValue('acme/entry-blob');
  store.s3PresignPutUrl.mockResolvedValue('https://store.test/put');
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 200 }));
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe('materializing an entry', () => {
  it('marks the first version queued before its indexing job is enqueued', async () => {
    const { sql, statements } = fakeSql({});

    const written = await createKnowledgeEntry(sql, {
      ...WRITER,
      topic: 'Store hours',
      content: 'Open 9-5',
    });

    // The entry AND the document it lives in: the document is what a
    // caller polls for `indexing`, so it is answered on the create itself.
    expect(written).toEqual({ id: 'entry-new', documentId: 'doc-1' });
    // The digest goes in the `content_hash` COLUMN the platform reads, never
    // into the caller-owned `metadata` bag (where a metadata PATCH used to
    // drop it in silence).
    const insert = statements.find((s) =>
      s.text.includes('INSERT INTO app.documents'),
    );
    expect(insert?.text).toContain('content_hash');
    expect(insert?.text).not.toContain('metadata');
    expect(insert?.values).toContain(
      createHash('sha256').update('Open 9-5').digest('hex'),
    );

    // NULL until the worker's first write read as "Not indexed"; a job lost
    // after its retries left it there forever, outside the watchdog's view.
    expect(markRagQueued).toHaveBeenCalledWith(expect.anything(), 'file-1');
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'rag.index_file',
      { fileId: 'file-1' },
    );
    const queuedAt = markRagQueued.mock.invocationCallOrder[0] ?? Infinity;
    const enqueuedAt = addJobInTx.mock.invocationCallOrder[0] ?? 0;
    expect(queuedAt).toBeLessThan(enqueuedAt);
  });

  it('re-marks a rotated version queued and releases the outgoing ref', async () => {
    const { sql, statements } = fakeSql({
      current: {
        id: 'entry-old',
        topicKey: 'store hours',
        documentId: 'doc-1',
      },
      previousRef: 's3:acme/old-blob',
    });

    const written = await updateKnowledgeEntry(sql, {
      ...WRITER,
      entryId: 'entry-old',
      topic: 'Store hours',
      content: 'Open 9-6',
    });

    expect(written).toEqual({ id: 'entry-new', documentId: 'doc-1' });
    // The rotation rewrites the column, and leaves `metadata` alone.
    const rewrite = statements.find(
      (s) =>
        s.text.includes('UPDATE app.documents SET') &&
        s.text.includes('file_ref'),
    );
    expect(rewrite?.text).toContain('content_hash = ?');
    expect(rewrite?.text).not.toContain('metadata');
    expect(rewrite?.values).toContain(
      createHash('sha256').update('Open 9-6').digest('hex'),
    );
    expect(markRagQueued).toHaveBeenCalledWith(expect.anything(), 'file-1');
    const rotate = statements.find(
      (s) =>
        s.text.includes('UPDATE app.file_metadata') &&
        s.text.includes('RETURNING'),
    );
    // The rotation used to null the status outright; now it clears the
    // previous version's failure and leaves the state to `markRagQueued`.
    expect(rotate?.text).not.toContain('rag_status = NULL');
    expect(rotate?.text).toContain('rag_error = NULL');
    expect(rotate?.text).toContain('rag_error_code = NULL');
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'knowledge.release_refs',
      { organizationId: ORG, refs: ['s3:acme/old-blob'] },
    );
  });
});

describe('storing the entry blob', () => {
  it('gives up on a hung object store with a coded 503, not a hung request', async () => {
    // The budget is a real `AbortSignal.timeout`, which fake timers do not
    // drive; the test owns the signal and fires it the way the runtime does
    // (a `TimeoutError` reason), and checks the budget the path asked for.
    const controller = new AbortController();
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal);
    // A PUT that never answers — but honours its abort signal, the way
    // undici does when the timeout signal fires.
    fetchSpy.mockImplementation(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason),
          );
        }),
    );
    const { sql, statements } = fakeSql({});

    const outcome = createKnowledgeEntry(sql, {
      ...WRITER,
      topic: 'Store hours',
      content: 'Open 9-5',
    }).then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    controller.abort(
      new DOMException(
        'The operation was aborted due to timeout',
        'TimeoutError',
      ),
    );

    const error = await outcome;
    expect(error).toBeInstanceOf(KnowledgeEntryError);
    expect(error).toMatchObject({
      code: 'KNOWLEDGE_ENTRY_STORE_TIMEOUT',
      status: 503,
    });
    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    // The upload runs BEFORE the transaction: nothing was written.
    expect(statements.some((s) => s.text.includes('INSERT'))).toBe(false);
    timeoutSpy.mockRestore();
  });

  it('passes any other store failure through unchanged', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
    const { sql } = fakeSql({});

    await expect(
      createKnowledgeEntry(sql, {
        ...WRITER,
        topic: 'Store hours',
        content: 'Open 9-5',
      }),
    ).rejects.toThrow('fetch failed');
  });
});

/**
 * A superseded row is manifestly there — it reads, it lists under
 * `?status=superseded` — so a new version written onto it is refused by
 * its STATE (the documented 409, naming the row that replaced it), not by
 * the 404 a missing row answers. The lookup used to fold `status =
 * 'active'` into its predicate, so the two were indistinguishable.
 */
describe('a superseded entry', () => {
  it('refuses a new version with 409 naming its successor, and writes nothing', async () => {
    const { sql, statements } = fakeSql({
      current: {
        id: 'entry-old',
        topicKey: 'refunds',
        documentId: 'doc-1',
        status: 'superseded',
        supersededBy: 'entry-new',
      },
    });
    let caught: unknown;
    try {
      await updateKnowledgeEntry(sql, {
        ...WRITER,
        entryId: 'entry-old',
        topic: 'Refunds',
        content: 'v3',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KnowledgeEntryError);
    expect(caught).toMatchObject({
      code: 'KNOWLEDGE_ENTRY_SUPERSEDED',
      status: 409,
      message: expect.stringContaining('entry-new'),
    });
    expect(
      statements.some((s) =>
        s.text.includes('INSERT INTO app.knowledge_entries'),
      ),
    ).toBe(false);
  });
});

describe('an entry whose backing document is gone', () => {
  it('refuses a new version as not found once the document is not active', async () => {
    // The read joins the document's lifecycle; a trashed document yields no
    // row. Without the gate the edit rotated the blob and enqueued indexing
    // onto a document nobody can retrieve.
    const { sql, statements } = fakeSql({});

    await expect(
      updateKnowledgeEntry(sql, {
        ...WRITER,
        entryId: 'entry-old',
        topic: 'Store hours',
        content: 'Open 9-6',
      }),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_ENTRY_NOT_FOUND', status: 404 });
    const read = statements.find((s) =>
      s.text.includes('LEFT JOIN app.documents'),
    );
    expect(read?.text).toContain("lifecycle_status = 'active'");
    expect(statements.some((s) => s.text.includes('INSERT'))).toBe(false);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('soft-deletes the chain the document backs, keyed by document inside the organization', async () => {
    const { sql, statements } = fakeSql({});

    const marked = await markEntryChainDeletedForDocument(sql, ORG, 'doc-1');

    expect(marked).toBe(3);
    // One statement, addressed by (org, document) and nothing else: a
    // deleted chain's topic key is free for a NEW entry backed by a NEW
    // document, so a hop through the topic key would let a late purge of
    // the old document retire the live chain that reused the key. Every
    // version of a chain shares its document, so the document is the chain.
    expect(statements).toHaveLength(1);
    expect(statements[0]?.values).toEqual([expect.any(Number), ORG, ['doc-1']]);
  });

  it('retires the chains of a whole batch of documents in one statement, and none for an empty batch', async () => {
    const { sql, statements } = fakeSql({});

    const none = await markEntryChainsDeletedForDocuments(sql, ORG, []);
    expect(none).toBe(0);
    expect(statements).toHaveLength(0);

    const marked = await markEntryChainsDeletedForDocuments(sql, ORG, [
      'doc-1',
      'doc-2',
    ]);

    expect(marked).toBe(3);
    expect(statements).toHaveLength(1);
    expect(statements[0]?.values).toEqual([
      expect.any(Number),
      ORG,
      ['doc-1', 'doc-2'],
    ]);
  });
});
