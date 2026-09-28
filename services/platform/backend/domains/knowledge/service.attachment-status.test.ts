// @vitest-environment node

/**
 * What an attachment's status reads, and who is told when it moves.
 *
 * A chat's first attachments are registered before its thread exists, so a
 * `.doc` sent in a fresh chat landed on the terminal "Not supported" while
 * the same `.doc` sent in an existing thread kept an empty status for good:
 * the turn's backstop only ever queued, and `rag_fetch` then told the model
 * to index it from a Knowledge tab that does not list it. Both now take one
 * decision (`markUploadUnsupportedIfNoExtractor`), and the backstop gives a
 * status-less attachment the same answer.
 *
 * Every status write used to make every open Documents list in the
 * organization refetch — for a chat or task upload too, which no list shows.
 * The writer now asks whether a document holds the file, and only then hints.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RAG_ERROR_UNSUPPORTED_TYPE } from '../../core/knowledge/rag_error_codes.ts';

const { addJobInTx, emitHintInTx } = vi.hoisted(() => ({
  addJobInTx: vi.fn(),
  emitHintInTx: vi.fn(),
}));

vi.mock('../../jobs/enqueue.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../jobs/enqueue.ts')>()),
  addJobInTx,
}));
vi.mock('../../realtime/outbox.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../realtime/outbox.ts')>()),
  emitHintInTx,
}));

const {
  HELD_BY_DOCUMENT_SQL,
  markRagUnsupportedIfNoExtractor,
  markUploadUnsupportedIfNoExtractor,
  queueRagIndexIfUnstarted,
} = await import('./service.ts');

interface Statement {
  text: string;
  values: unknown[];
}

interface FileRow {
  id: string;
  fileName: string;
  contentType: string;
}

/**
 * Scripted `sql`: the backstop's claim answers `claimable` (the row still
 * without a status, or none), and the status writer's UPDATE answers the
 * row's organization and whether a document holds it.
 */
function fakeSql(
  options: { listed?: boolean; claimable?: FileRow | null } = {},
): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$').replace(/\s+/g, ' ');
    statements.push({ text, values });
    if (text.includes('RETURNING fm.org_id')) {
      return Promise.resolve([
        { orgId: 'org-1', listed: options.listed ?? false },
      ]);
    }
    if (
      text.includes('FROM app.file_metadata') &&
      text.includes('FOR UPDATE')
    ) {
      return Promise.resolve(options.claimable ? [options.claimable] : []);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    unsafe: (raw: string) => raw,
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, statements };
}

const statusWrites = (statements: Statement[]): Statement[] =>
  statements.filter((s) => s.text.includes('UPDATE app.file_metadata fm'));

const queueMarks = (statements: Statement[]): Statement[] =>
  statements.filter((s) => s.text.includes("rag_status = 'queued'"));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the status writer tells only the lists that show the file', () => {
  it('asks, in the write itself, whether a document holds the file', async () => {
    const { sql, statements } = fakeSql();
    await markRagUnsupportedIfNoExtractor(sql, 'file-1', 'minutes.doc');
    const [write] = statusWrites(statements);
    expect(write?.text).toContain('AS "listed"');
    expect(write?.values).toContain(HELD_BY_DOCUMENT_SQL);
  });

  it('hints the document lists for a file a document holds', async () => {
    const { sql } = fakeSql({ listed: true });
    await markRagUnsupportedIfNoExtractor(sql, 'file-1', 'minutes.doc');
    expect(emitHintInTx).toHaveBeenCalledTimes(1);
    expect(emitHintInTx).toHaveBeenCalledWith(sql, {
      orgId: 'org-1',
      entity: 'document',
      entityId: null,
    });
  });

  it('hints nothing for an attachment, which no list shows', async () => {
    const { sql, statements } = fakeSql({ listed: false });
    await markRagUnsupportedIfNoExtractor(sql, 'file-1', 'minutes.doc');
    expect(statusWrites(statements)).toHaveLength(1);
    expect(emitHintInTx).not.toHaveBeenCalled();
  });
});

describe('markUploadUnsupportedIfNoExtractor — one answer for every upload no lane queued', () => {
  it.each([
    ['minutes.doc', 'application/msword'],
    ['bundle.zip', 'application/zip'],
    ['standup.loop', 'application/octet-stream'],
  ])(
    'lands %s on unsupported_type with the indexer’s sentence',
    async (fileName, contentType) => {
      const { sql, statements } = fakeSql();
      await expect(
        markUploadUnsupportedIfNoExtractor(sql, {
          id: 'file-1',
          fileName,
          contentType,
        }),
      ).resolves.toBe(true);
      const writes = statusWrites(statements);
      expect(writes).toHaveLength(1);
      expect(writes[0]?.values).toEqual(
        expect.arrayContaining([
          'unsupported',
          `No text extractor exists for "${fileName}".`,
          RAG_ERROR_UNSUPPORTED_TYPE,
          'file-1',
        ]),
      );
    },
  );

  // No extractor reads any of these names either: without the exclusions a
  // recording would read "Not supported" while its transcript is being made,
  // and an image would contradict the register door's vision-metadata stamp.
  it.each([
    ['audio', 'memo.m4a', 'audio/mp4'],
    ['video', 'standup.mp4', 'video/mp4'],
    ['an image', 'photo.heic', 'image/heic'],
    ['a `.log`, which the indexer reads', 'server.log', 'text/plain'],
  ])('writes nothing for %s', async (_label, fileName, contentType) => {
    const { sql, statements } = fakeSql();
    await expect(
      markUploadUnsupportedIfNoExtractor(sql, {
        id: 'file-1',
        fileName,
        contentType,
      }),
    ).resolves.toBe(false);
    expect(statements).toEqual([]);
  });
});

describe('queueRagIndexIfUnstarted — the turn’s backstop for an attachment with no status', () => {
  it('lands a `.doc` no upload queued on its terminal state, and says so', async () => {
    const { sql, statements } = fakeSql({
      claimable: {
        id: 'file-1',
        fileName: 'minutes.doc',
        contentType: 'application/msword',
      },
    });

    await expect(
      queueRagIndexIfUnstarted(sql, 's3:acme/minutes'),
    ).resolves.toBe('unsupported');

    const writes = statusWrites(statements);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.values).toEqual(
      expect.arrayContaining([
        'unsupported',
        'No text extractor exists for "minutes.doc".',
        RAG_ERROR_UNSUPPORTED_TYPE,
        'file-1',
      ]),
    );
    expect(queueMarks(statements)).toEqual([]);
    expect(addJobInTx).not.toHaveBeenCalled();
    // A chat attachment: no document list to tell.
    expect(emitHintInTx).not.toHaveBeenCalled();
  });

  it('still starts the run for a file an upload would have queued', async () => {
    const { sql, statements } = fakeSql({
      claimable: {
        id: 'file-1',
        fileName: 'report.pdf',
        contentType: 'application/pdf',
      },
    });

    await expect(queueRagIndexIfUnstarted(sql, 's3:acme/report')).resolves.toBe(
      'queued',
    );

    expect(queueMarks(statements)).toHaveLength(1);
    expect(statusWrites(statements)).toEqual([]);
    expect(addJobInTx).toHaveBeenCalledWith(sql, 'rag.index_file', {
      fileId: 'file-1',
    });
  });

  it.each([
    ['a `.log`, which the indexer reads', 'server.log', 'text/plain'],
    ['a recording', 'memo.m4a', 'audio/mp4'],
  ])('leaves %s on its empty status', async (_label, fileName, contentType) => {
    const { sql, statements } = fakeSql({
      claimable: { id: 'file-1', fileName, contentType },
    });

    await expect(
      queueRagIndexIfUnstarted(sql, 's3:acme/file'),
    ).resolves.toBeNull();

    expect(statusWrites(statements)).toEqual([]);
    expect(queueMarks(statements)).toEqual([]);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('claims only a row that still has no status, is not opted out and is no document’s', async () => {
    const { sql, statements } = fakeSql({ claimable: null });

    await expect(
      queueRagIndexIfUnstarted(sql, 's3:acme/minutes'),
    ).resolves.toBeNull();

    const [claim] = statements;
    expect(claim?.text).toContain('rag_status IS NULL');
    expect(claim?.text).toContain('skip_rag_indexing IS DISTINCT FROM true');
    expect(claim?.text).toContain('document_id IS NULL');
    expect(statements).toHaveLength(1);
  });
});
