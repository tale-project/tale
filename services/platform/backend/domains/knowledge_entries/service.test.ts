// @vitest-environment node

import type { Sql, TransactionSql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const { createKnowledgeEntry, updateKnowledgeEntry } =
  await import('./service.ts');

interface Statement {
  text: string;
  values: unknown[];
}

interface Script {
  /** The active entry `updateKnowledgeEntry` loads (with its document). */
  current?: {
    id: string;
    topicKey: string;
    documentId: string | null;
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
    if (text.includes('topic_key AS "topicKey", document_id')) {
      return Promise.resolve(script.current ? [script.current] : []);
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

let fetchSpy: ReturnType<typeof vi.spyOn>;

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
  vi.useRealTimers();
});

describe('materializing an entry', () => {
  it('marks the first version queued before its indexing job is enqueued', async () => {
    const { sql } = fakeSql({});

    await createKnowledgeEntry(sql, {
      ...WRITER,
      topic: 'Store hours',
      content: 'Open 9-5',
    });

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

    await updateKnowledgeEntry(sql, {
      ...WRITER,
      entryId: 'entry-old',
      topic: 'Store hours',
      content: 'Open 9-6',
    });

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
