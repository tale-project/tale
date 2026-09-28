// @vitest-environment node

/**
 * What a sync import does about a file's RAG indexing, for both providers
 * that share the pg import deps. A file no extractor reads — a Loop page
 * arrives as `standup.loop`, `application/octet-stream` — used to be skipped
 * with nothing written: the list read "Not indexed" with a Reindex that could
 * never succeed, and REST `pending`. It is now handed to the lane that lands
 * such a file on the terminal `unsupported` + `unsupported_type` state the
 * indexer gives it, and never queued; the list hides Reindex for that status
 * (`document-row-actions.test.tsx`) and the retry door refuses it.
 *
 * The unit here only decides which knowledge helper runs, with what: the
 * helpers' own statements and hints — which names they write, the sentence,
 * who hears it — are theirs to prove (`knowledge/service.status-codes.test.ts`,
 * `knowledge/service.attachment-status.test.ts`), so rewording their SQL never
 * breaks a sync test.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { createGoogleDriveImportDeps } from '../google_drive/service.ts';
import {
  markRagQueued,
  markRagUnsupportedIfNoExtractor,
} from '../knowledge/service.ts';
import { createPgImportDeps, type PgSyncImportDeps } from './service.ts';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../knowledge/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../knowledge/service.ts')>()),
  markRagQueued: vi.fn(() => Promise.resolve()),
  markRagUnsupportedIfNoExtractor: vi.fn(() => Promise.resolve(true)),
  syncRagDocumentScope: vi.fn(() => Promise.resolve()),
}));

interface FileRow {
  id: string;
  fileName: string;
  contentType: string;
  threadId: string | null;
  skipRagIndexing: boolean | null;
  ragStatus: string | null;
}

/**
 * A document on one synced blob and the file row that tracks it, answered by
 * position — the unit reads the document, then its file — so no answer
 * depends on how either read is worded. `tx` is the handle `sql.begin` hands
 * its body.
 */
function fakeSql(
  doc: { title: string; mimeType: string },
  file: Partial<FileRow> = {},
): { sql: Sql; tx: unknown } {
  const row: FileRow = {
    id: 'file-1',
    fileName: doc.title,
    contentType: doc.mimeType,
    threadId: null,
    skipRagIndexing: null,
    ragStatus: null,
    ...file,
  };
  const answers: unknown[][] = [
    [{ fileRef: 's3:org-1/blob-1', title: doc.title, mimeType: doc.mimeType }],
    [row],
  ];
  let reads = 0;
  const tag = () => Promise.resolve(answers[reads++] ?? []);
  const tx = { handle: 'tx' };
  const sql = Object.assign(tag, {
    begin: (fn: (handle: unknown) => Promise<void>) => fn(tx),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, tx };
}

const LOOP = { title: 'standup.loop', mimeType: 'application/octet-stream' };

/** Neither lane ran: no terminal state, no queued run. */
function expectUntouched(): void {
  expect(markRagUnsupportedIfNoExtractor).not.toHaveBeenCalled();
  expect(markRagQueued).not.toHaveBeenCalled();
  expect(addJobInTx).not.toHaveBeenCalled();
}

afterEach(() => {
  vi.clearAllMocks();
});

describe.each<[string, (sql: Sql, organizationId: string) => PgSyncImportDeps]>(
  [
    ['OneDrive', createPgImportDeps],
    ['Google Drive', createGoogleDriveImportDeps],
  ],
)('%s sync: scheduleHubDocumentRagIndexing', (_provider, createDeps) => {
  it('hands a synced `.loop` to the terminal lane and queues nothing', async () => {
    const { sql } = fakeSql(LOOP);

    await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

    expect(markRagUnsupportedIfNoExtractor).toHaveBeenCalledTimes(1);
    expect(markRagUnsupportedIfNoExtractor).toHaveBeenCalledWith(
      sql,
      'file-1',
      'standup.loop',
    );
    expect(markRagQueued).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('does nothing again once the file is unsupported — every scan re-offers it', async () => {
    const { sql } = fakeSql(LOOP, { ragStatus: 'unsupported' });

    await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

    expectUntouched();
  });

  // The indexer made these terminal (`image_no_vision`, `empty`); a rescan
  // used to flip them back to `queued` and download and refuse them again
  // on every scan.
  it.each([
    ['an image', { title: 'photo.png', mimeType: 'image/png' }],
    ['an empty text file', { title: 'blank.txt', mimeType: 'text/plain' }],
  ])(
    'never re-queues %s the indexer already made unsupported',
    async (_label, doc) => {
      const { sql } = fakeSql(doc, { ragStatus: 'unsupported' });

      await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

      expectUntouched();
    },
  );

  // A document title is renamed on its own (REST PATCH, the app's rename);
  // the indexer reads the stored file name, so a title that merely looks
  // like an unknown extension must never be what the terminal lane judges —
  // it writes nothing for a name an extractor reads.
  it.each([
    [
      'Minutes 27.09',
      'Minutes 27.09.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    ['Board minutes 27.09.2026', 'minutes.pdf', 'application/pdf'],
  ])(
    'judges by the file name, not a renamed title (%s)',
    async (title, fileName, mimeType) => {
      const { sql } = fakeSql(
        { title, mimeType },
        { fileName, ragStatus: 'failed' },
      );

      await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

      expect(markRagUnsupportedIfNoExtractor).toHaveBeenCalledWith(
        sql,
        'file-1',
        fileName,
      );
      expect(markRagUnsupportedIfNoExtractor).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        title,
      );
    },
  );

  it('names the stored file to the terminal lane, not the title', async () => {
    const { sql } = fakeSql(
      { title: 'Standup', mimeType: 'application/octet-stream' },
      { fileName: 'standup.loop' },
    );

    await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

    expect(markRagUnsupportedIfNoExtractor).toHaveBeenCalledWith(
      sql,
      'file-1',
      'standup.loop',
    );
    expect(markRagQueued).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it.each(['completed', 'running', 'queued'])(
    'leaves a %s file as it is',
    async (ragStatus) => {
      const { sql } = fakeSql(LOOP, { ragStatus });

      await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

      expectUntouched();
    },
  );

  it.each([
    ['a chat-bound file', { threadId: 'thread-1' }],
    ['an opted-out file', { skipRagIndexing: true }],
  ])('leaves %s alone', async (_label, file) => {
    const { sql } = fakeSql(LOOP, file);

    await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

    expectUntouched();
  });

  // The platform does not index a `.log` by itself, but the text extractor
  // reads it, so the terminal lane leaves its status empty and a Reindex
  // can index it.
  it('hands a `.log` to the terminal lane rather than queueing it', async () => {
    const { sql } = fakeSql({ title: 'server.log', mimeType: 'text/plain' });

    await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

    expect(markRagUnsupportedIfNoExtractor).toHaveBeenCalledWith(
      sql,
      'file-1',
      'server.log',
    );
    expect(markRagQueued).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('still queues an indexable file, in one transaction with its job', async () => {
    const { sql, tx } = fakeSql({ title: 'notes.txt', mimeType: 'text/plain' });

    await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

    expect(markRagQueued).toHaveBeenCalledTimes(1);
    expect(markRagQueued).toHaveBeenCalledWith(tx, 'file-1');
    expect(addJobInTx).toHaveBeenCalledWith(tx, 'rag.index_file', {
      fileId: 'file-1',
    });
    expect(markRagUnsupportedIfNoExtractor).not.toHaveBeenCalled();
  });
});
