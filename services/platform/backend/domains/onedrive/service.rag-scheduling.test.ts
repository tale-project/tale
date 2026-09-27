// @vitest-environment node

/**
 * What a sync import does about a file's RAG indexing, for both providers
 * that share the pg import deps. A file no extractor reads — a Loop page
 * arrives as `standup.loop`, `application/octet-stream` — used to be skipped
 * with nothing written: the list read "Not indexed" with a Reindex that could
 * never succeed, and REST `pending`. It now lands on the terminal
 * `unsupported` + `unsupported_type` state the indexer gives such a file,
 * written once and never queued; the list hides Reindex for that status
 * (`document-row-actions.test.tsx`) and the retry door refuses it.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RAG_ERROR_UNSUPPORTED_TYPE } from '../../core/knowledge/rag_error_codes.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { createGoogleDriveImportDeps } from '../google_drive/service.ts';
import { createPgImportDeps, type PgSyncImportDeps } from './service.ts';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));

interface Statement {
  text: string;
  values: unknown[];
}

interface FileRow {
  id: string;
  fileName: string;
  contentType: string;
  threadId: string | null;
  skipRagIndexing: boolean | null;
  ragStatus: string | null;
}

/** A document on one synced blob and the file row that tracks it. */
function fakeSql(
  doc: { title: string; mimeType: string },
  file: Partial<FileRow> = {},
): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const row: FileRow = {
    id: 'file-1',
    fileName: doc.title,
    contentType: doc.mimeType,
    threadId: null,
    skipRagIndexing: null,
    ragStatus: null,
    ...file,
  };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$');
    statements.push({ text, values });
    if (text.includes('FROM app.documents WHERE id')) {
      return Promise.resolve([
        {
          fileRef: 's3:org-1/blob-1',
          title: doc.title,
          mimeType: doc.mimeType,
        },
      ]);
    }
    if (text.includes('FROM app.file_metadata')) {
      return Promise.resolve([row]);
    }
    if (text.includes('RETURNING org_id')) {
      return Promise.resolve([{ orgId: 'org-1' }]);
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

const LOOP = { title: 'standup.loop', mimeType: 'application/octet-stream' };

const statusWrites = (statements: Statement[]): Statement[] =>
  statements.filter((s) => s.text.includes('UPDATE app.file_metadata'));

const hints = (statements: Statement[]): Statement[] =>
  statements.filter((s) => s.text.includes('INSERT INTO app_realtime.outbox'));

afterEach(() => {
  vi.clearAllMocks();
});

describe.each<[string, (sql: Sql, organizationId: string) => PgSyncImportDeps]>(
  [
    ['OneDrive', createPgImportDeps],
    ['Google Drive', createGoogleDriveImportDeps],
  ],
)('%s sync: scheduleHubDocumentRagIndexing', (_provider, createDeps) => {
  it('lands a synced `.loop` on unsupported_type and queues nothing', async () => {
    const { sql, statements } = fakeSql(LOOP);

    await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

    const writes = statusWrites(statements);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.text).toContain('rag_error_code =');
    expect(writes[0]?.values).toEqual(
      expect.arrayContaining([
        'unsupported',
        'No text extractor exists for "standup.loop".',
        RAG_ERROR_UNSUPPORTED_TYPE,
        'file-1',
      ]),
    );
    expect(addJobInTx).not.toHaveBeenCalled();
    // The open document list refetches, so the row flips to "Not supported".
    expect(hints(statements).map((s) => s.values)).toEqual([
      ['org-1', null, 'document', null],
    ]);
  });

  it('writes nothing again once the file is unsupported — every scan re-offers it', async () => {
    const { sql, statements } = fakeSql(LOOP, { ragStatus: 'unsupported' });

    await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

    expect(statusWrites(statements)).toEqual([]);
    expect(hints(statements)).toEqual([]);
    expect(addJobInTx).not.toHaveBeenCalled();
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
      const { sql, statements } = fakeSql(doc, { ragStatus: 'unsupported' });

      await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

      expect(statusWrites(statements)).toEqual([]);
      expect(hints(statements)).toEqual([]);
      expect(addJobInTx).not.toHaveBeenCalled();
    },
  );

  // A document title is renamed on its own (REST PATCH, the app's rename);
  // the indexer reads the stored file name, so a title that merely looks
  // like an unknown extension must never make a readable file terminal.
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
      const { sql, statements } = fakeSql(
        { title, mimeType },
        { fileName, ragStatus: 'failed' },
      );

      await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

      expect(statusWrites(statements)).toEqual([]);
      expect(hints(statements)).toEqual([]);
    },
  );

  it('names the stored file in the sentence, not the title', async () => {
    const { sql, statements } = fakeSql(
      { title: 'Standup', mimeType: 'application/octet-stream' },
      { fileName: 'standup.loop' },
    );

    await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

    const writes = statusWrites(statements);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.values).toEqual(
      expect.arrayContaining([
        'unsupported',
        'No text extractor exists for "standup.loop".',
        RAG_ERROR_UNSUPPORTED_TYPE,
      ]),
    );
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it.each(['completed', 'running', 'queued'])(
    'leaves a %s file as it is',
    async (ragStatus) => {
      const { sql, statements } = fakeSql(LOOP, { ragStatus });

      await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

      expect(statusWrites(statements)).toEqual([]);
      expect(addJobInTx).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a chat-bound file', { threadId: 'thread-1' }],
    ['an opted-out file', { skipRagIndexing: true }],
  ])('leaves %s alone', async (_label, file) => {
    const { sql, statements } = fakeSql(LOOP, file);

    await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

    expect(statusWrites(statements)).toEqual([]);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('keeps `.log` on its empty status: the indexer reads it, so it is not terminal', async () => {
    const { sql, statements } = fakeSql({
      title: 'server.log',
      mimeType: 'text/plain',
    });

    await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

    expect(statusWrites(statements)).toEqual([]);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('still queues an indexable file', async () => {
    const { sql, statements } = fakeSql({
      title: 'notes.txt',
      mimeType: 'text/plain',
    });

    await createDeps(sql, 'org-1').scheduleHubDocumentRagIndexing('doc-1');

    const writes = statusWrites(statements);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.text).toContain("rag_status = 'queued'");
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'rag.index_file',
      { fileId: 'file-1' },
    );
  });
});
