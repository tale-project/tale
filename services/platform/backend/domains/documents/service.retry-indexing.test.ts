// @vitest-environment node

/**
 * "Index now" on a file that opted out of indexing at its bind (a REST-bound
 * project file — `skipRagIndexing` defaults to true there). `markRagQueued`
 * leaves an opted-out row untouched and the indexer drops it on its own
 * guard, so a retry used to queue a job that did nothing while the row read
 * "queued" for ever. What is pinned: the explicit retry clears the opt-out
 * BEFORE the queue mark, inside the same transaction, and a file that never
 * opted out is left alone.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  queueRagIndexingRetry,
  retryRagIndexingForDocument,
  type DocumentRow,
} from './service.ts';

vi.mock('../../lib/rate-limit.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/rate-limit.ts')>()),
  checkUserRateLimit: vi.fn(),
}));
vi.mock('../../jobs/enqueue.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../jobs/enqueue.ts')>()),
  addJobInTx: vi.fn(),
}));
vi.mock('../../realtime/outbox.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../realtime/outbox.ts')>()),
  emitHintInTx: vi.fn(),
}));

interface Statement {
  text: string;
  values: unknown[];
}

/** One hub document (no team, no project → visible to any member) and its
 * file row — `null` for a blob the platform does not track. `sql` is
 * callable AND transactional: `begin` hands the same recorder back as the
 * transaction. */
function fakeSql(
  file: {
    skipRagIndexing: boolean | null;
    ragStatus: string | null;
    ragError?: string | null;
    ragQueuedAt?: number | null;
  } | null,
): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM app.documents')) {
      return Promise.resolve([
        {
          id: 'doc-1',
          organizationId: 'org_1',
          title: 'lead-verify.txt',
          fileRef: 's3:acme/lead-verify.txt',
          teamId: null,
          teamTags: [],
          projectId: null,
          folderId: null,
        },
      ]);
    }
    if (text.includes('FROM app.file_metadata')) {
      if (file === null) return Promise.resolve([]);
      return Promise.resolve([
        {
          id: 'fm-1',
          ragStatus: file.ragStatus,
          ragError: file.ragError ?? null,
          ragQueuedAt: file.ragQueuedAt ?? null,
          createdAt: 1_700_000_000_000,
          skipRagIndexing: file.skipRagIndexing,
        },
      ]);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(run, {
    unsafe: (text: string) => text,
    begin: (callback: (tx: typeof run) => unknown): unknown => callback(run),
  }) as unknown as Sql;
  return { sql, statements };
}

const AUTH = {
  organizationId: 'org_1',
  userId: 'user_1',
  role: 'admin' as const,
  teamIds: [] as string[],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('retryRagIndexingForDocument — the explicit opt-in', () => {
  it('clears a bind-time opt-out before queueing, in the same transaction', async () => {
    const { sql, statements } = fakeSql({
      skipRagIndexing: true,
      ragStatus: null,
    });
    const result = await retryRagIndexingForDocument(sql, AUTH, 'doc-1');
    expect(result).toEqual({ success: true });

    const updates = statements
      .filter((s) => s.text.startsWith('UPDATE app.file_metadata'))
      .map((s) => s.text);
    expect(updates[0]).toContain('SET skip_rag_indexing = false');
    expect(updates[1]).toContain("rag_status = 'queued'");
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'rag.index_file',
      { fileId: 'fm-1' },
      expect.anything(),
    );
  });

  it('answers the unsupported and in-progress guards as sentences, writing nothing', async () => {
    const unsupported = fakeSql({
      skipRagIndexing: false,
      ragStatus: 'unsupported',
      ragError: 'No extractor for .xyz',
    });
    expect(
      await retryRagIndexingForDocument(unsupported.sql, AUTH, 'doc-1'),
    ).toEqual({ success: false, error: 'No extractor for .xyz' });
    const running = fakeSql({
      skipRagIndexing: false,
      ragStatus: 'running',
      ragQueuedAt: Date.now() - 60_000,
    });
    expect(
      await retryRagIndexingForDocument(running.sql, AUTH, 'doc-1'),
    ).toEqual({
      success: false,
      error: 'Indexing is already in progress for this file.',
    });
    for (const { statements } of [unsupported, running]) {
      expect(
        statements.some((s) => s.text.startsWith('UPDATE app.file_metadata')),
      ).toBe(false);
    }
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  /** The core both doors call names its decision — the REST door's
   * `reason` is this `kind`, the app's sentence a rendering of it. */
  it('names each outcome as a kind for the door that asked', async () => {
    const doc = {
      id: 'doc-1',
      organizationId: 'org_1',
      fileRef: 's3:acme/lead-verify.txt',
    } as unknown as DocumentRow;
    expect(
      await queueRagIndexingRetry(
        fakeSql({ skipRagIndexing: false, ragStatus: 'unsupported' }).sql,
        AUTH,
        doc,
      ),
    ).toMatchObject({ kind: 'unsupported' });
    expect(
      await queueRagIndexingRetry(
        fakeSql({
          skipRagIndexing: false,
          ragStatus: 'queued',
          ragQueuedAt: Date.now(),
        }).sql,
        AUTH,
        doc,
      ),
    ).toEqual({ kind: 'in-progress' });
    expect(
      await queueRagIndexingRetry(
        fakeSql({ skipRagIndexing: null, ragStatus: 'failed' }).sql,
        AUTH,
        { ...doc, fileRef: null } as DocumentRow,
      ),
    ).toEqual({ kind: 'content-only' });
    expect(
      await queueRagIndexingRetry(
        fakeSql({ skipRagIndexing: null, ragStatus: 'failed' }).sql,
        AUTH,
        doc,
      ),
    ).toEqual({ kind: 'queued' });
  });

  /** Each skip is its own sentence (round e, S4): an untracked blob used
   * to read "Document has no file" — the content-only sentence — which
   * sent a person to upload a file the document already had. */
  it('names an untracked blob as its own sentence, writing nothing', async () => {
    const { sql, statements } = fakeSql(null);
    expect(await retryRagIndexingForDocument(sql, AUTH, 'doc-1')).toEqual({
      success: false,
      error:
        "The platform doesn't track this file's blob, so it can't be indexed.",
    });
    expect(
      statements.some((s) => s.text.startsWith('UPDATE app.file_metadata')),
    ).toBe(false);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('leaves a file that never opted out alone', async () => {
    const { sql, statements } = fakeSql({
      skipRagIndexing: false,
      ragStatus: 'failed',
    });
    const result = await retryRagIndexingForDocument(sql, AUTH, 'doc-1');
    expect(result).toEqual({ success: true });
    expect(
      statements.some((s) => s.text.includes('SET skip_rag_indexing = false')),
    ).toBe(false);
    expect(addJobInTx).toHaveBeenCalledTimes(1);
  });
});
