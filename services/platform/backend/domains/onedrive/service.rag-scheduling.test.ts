// @vitest-environment node

/**
 * What a sync import does about a file's RAG indexing, for both providers
 * that share the pg import deps. A file no extractor reads — a Loop page
 * arrives as `standup.loop`, `application/octet-stream` — used to be skipped
 * with nothing written: the list read "Not indexed" with a Reindex that could
 * never succeed, and REST `pending`. It is now handed to the lane that lands
 * such a file on the terminal `unsupported` + `unsupported_type` state the
 * indexer gives it, and never queued; the list hides Reindex for that status
 * (`document-row-actions.test.tsx`) and the retry door refuses it. Every
 * decision is the stored file's — its name, the one the indexer reads — and
 * never the document's title or type, which are renamed on their own: the
 * document is read for its blob reference alone. The fake answers each read
 * with the columns it selects and nothing else, so a case can only set what
 * the scheduler reads.
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

/** The stored file, as the scheduler's file read selects it. */
interface FileRow {
  id: string;
  fileName: string;
  threadId: string | null;
  skipRagIndexing: boolean | null;
  ragStatus: string | null;
}

/**
 * A synced document's blob and the file row it is stored as, answered by
 * position — the unit reads the document, then its file — so no answer
 * depends on how either read is worded. The document read is answered with
 * the blob reference alone. `reads` holds each read's text; `tx` is the
 * handle `sql.begin` hands its body.
 */
function fakeSql(file: Pick<FileRow, 'fileName'> & Partial<FileRow>): {
  sql: Sql;
  tx: unknown;
  reads: string[];
} {
  const row: FileRow = {
    id: 'file-1',
    threadId: null,
    skipRagIndexing: null,
    ragStatus: null,
    ...file,
  };
  const answers: unknown[][] = [[{ fileRef: 's3:org-1/blob-1' }], [row]];
  const reads: string[] = [];
  const tag = (strings: TemplateStringsArray) => {
    reads.push(strings.join('?').replace(/\s+/g, ' ').trim());
    return Promise.resolve(answers[reads.length - 1] ?? []);
  };
  const tx = { handle: 'tx' };
  const sql = Object.assign(tag, {
    begin: (fn: (handle: unknown) => Promise<void>) => fn(tx),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, tx, reads };
}

/** The columns a read selects, by their source names. */
function selectedColumns(read: string | undefined): string[] {
  const list = /^SELECT (.+?) FROM /.exec(read ?? '')?.[1] ?? '';
  return list.split(',').map((column) => column.trim().split(' ')[0] ?? '');
}

/** A Microsoft Loop page, as OneDrive stores it. */
const LOOP = { fileName: 'standup.loop' };

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
  // A document title is renamed on its own (REST PATCH, the app's rename)
  // and its type with it, and neither decides. A title of "Minutes 27.09"
  // reads as extension `09`, which once sent a readable `minutes.docx` to
  // the terminal lane on every rescan; a title ending in `.pdf` over a
  // `standup.loop` queued a job the indexer only refuses.
  it('reads the document for its blob reference alone, and the file for the columns the fake answers', async () => {
    const { sql, reads } = fakeSql(LOOP);

    await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

    expect(reads[0]).toContain('FROM app.documents');
    expect(selectedColumns(reads[0])).toEqual(['file_ref']);
    expect(reads[1]).toContain('FROM app.file_metadata');
    expect(selectedColumns(reads[1])).toEqual([
      'id',
      'file_name',
      'thread_id',
      'skip_rag_indexing',
      'rag_status',
    ]);
  });

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

  // The indexer reads a file by its name alone, and refuses one without an
  // extension whatever the provider typed it: queueing it bought a job that
  // could only end `unsupported`.
  it('hands a stored name without an extension to the terminal lane', async () => {
    const { sql } = fakeSql({ fileName: 'README' });

    await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

    expect(markRagUnsupportedIfNoExtractor).toHaveBeenCalledWith(
      sql,
      'file-1',
      'README',
    );
    expect(markRagQueued).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('does nothing again once the file is unsupported — every scan re-offers it', async () => {
    const { sql } = fakeSql({ ...LOOP, ragStatus: 'unsupported' });

    await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

    expectUntouched();
  });

  // The indexer made these terminal (`image_no_vision`, `empty`); a rescan
  // used to flip them back to `queued` and download and refuse them again
  // on every scan.
  it.each([
    ['an image', 'photo.png'],
    ['an empty text file', 'blank.txt'],
  ])(
    'never re-queues %s the indexer already made unsupported',
    async (_label, fileName) => {
      const { sql } = fakeSql({ fileName, ragStatus: 'unsupported' });

      await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

      expectUntouched();
    },
  );

  // The stored name is the one the indexer reads, so a dot inside it that
  // looks like an unknown extension never keeps a readable file from its
  // run: a rescan re-queues one whose last run failed.
  it.each([
    'minutes.docx',
    'Minutes 27.09.docx',
    'Board minutes 27.09.2026.pdf',
  ])('re-queues a failed file stored as %s', async (fileName) => {
    const { sql, tx } = fakeSql({ fileName, ragStatus: 'failed' });

    await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

    expect(markRagQueued).toHaveBeenCalledTimes(1);
    expect(markRagQueued).toHaveBeenCalledWith(tx, 'file-1');
    expect(addJobInTx).toHaveBeenCalledWith(tx, 'rag.index_file', {
      fileId: 'file-1',
    });
    expect(markRagUnsupportedIfNoExtractor).not.toHaveBeenCalled();
  });

  it.each(['completed', 'running', 'queued'])(
    'leaves a %s file as it is',
    async (ragStatus) => {
      const { sql } = fakeSql({ ...LOOP, ragStatus });

      await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

      expectUntouched();
    },
  );

  it.each([
    ['a chat-bound file', { threadId: 'thread-1' }],
    ['an opted-out file', { skipRagIndexing: true }],
  ])('leaves %s alone', async (_label, file) => {
    const { sql } = fakeSql({ ...LOOP, ...file });

    await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

    expectUntouched();
  });

  // The platform does not index a `.log` by itself, but the text extractor
  // reads it, so the terminal lane leaves its status empty and a Reindex
  // can index it.
  it('hands a `.log` to the terminal lane rather than queueing it', async () => {
    const { sql } = fakeSql({ fileName: 'server.log' });

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
    const { sql, tx } = fakeSql({ fileName: 'notes.txt' });

    await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

    expect(markRagQueued).toHaveBeenCalledTimes(1);
    expect(markRagQueued).toHaveBeenCalledWith(tx, 'file-1');
    expect(addJobInTx).toHaveBeenCalledWith(tx, 'rag.index_file', {
      fileId: 'file-1',
    });
    expect(markRagUnsupportedIfNoExtractor).not.toHaveBeenCalled();
  });
});
