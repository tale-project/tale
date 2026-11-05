// @vitest-environment node

/**
 * The on-demand lane behind `rag_fetch`
 * (`file_metadata/internal_queries:readTextOnDemandForAgent`). Admission is
 * the caller's; what is pinned here is the lane itself: it serves the text a
 * read on a worker checked and kept in the organization's knowledge database
 * (`read-text.ts`, `core/knowledge/kept_reads.ts`), states the read's
 * verdict — or the indexer's, for a file no read decided, and the index's
 * refusal over a read that let the text through — and answers a file
 * nothing has read yet, or whose kept text is gone, as `unread`, so the
 * caller can ask for its read. It never fetches, extracts or scans a byte:
 * it runs in the api process, beside every chat turn. A trashed row reads as
 * nothing, a picture answers its stored type and size, and the true indexing
 * state rides every answer.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readKeptText } from '../../core/knowledge/kept_reads.ts';

vi.mock('../../core/knowledge/kept_reads.ts', () => ({
  keepReadText: vi.fn(),
  readKeptText: vi.fn(),
  dropKeptText: vi.fn(),
}));

interface FileRow {
  fileName: string;
  contentType: string;
  size: number;
  lifecycleStatus: string | null;
  skipRagIndexing: boolean | null;
  ragStatus: string | null;
  ragError: string | null;
  ragErrorCode: string | null;
  heldByDocument: boolean;
  textStatus: string | null;
  textErrorCode: string | null;
}

/** Scripted `sql`: the one file-row read the lane makes, and the
 * organization's slug for a ready read's kept text. The trashed filter is
 * part of the statement, so the script applies it too. `unsafe` hands the
 * list probe back as its text. */
function fakeSql(
  rows: FileRow[],
  storageId: string,
): { sql: Sql; statements: string[] } {
  const statements: string[] = [];
  const fn = (strings: TemplateStringsArray, ...args: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push(text);
    if (text.includes('FROM app.file_metadata')) {
      expect(args.slice(-2)).toEqual(['org_1', storageId]);
      return Promise.resolve(
        rows.filter((entry) => entry.lifecycleStatus !== 'trashed'),
      );
    }
    if (text.includes('FROM "organization"')) {
      return Promise.resolve([{ slug: 'acme' }]);
    }
    throw new Error(`unexpected statement: ${text}`);
  };
  const sql = Object.assign(fn, { unsafe: (raw: string) => raw });
  return { sql: sql as unknown as Sql, statements };
}

const REF = 's3:tale/acme/report.pdf';

/** A chat attachment's PDF, read and queued for its index. */
function row(over: Partial<FileRow> = {}): FileRow {
  return {
    fileName: 'report.pdf',
    contentType: 'application/pdf',
    size: 2048,
    lifecycleStatus: null,
    skipRagIndexing: false,
    ragStatus: 'queued',
    ragError: null,
    ragErrorCode: null,
    heldByDocument: false,
    textStatus: 'ready',
    textErrorCode: null,
    ...over,
  };
}

const KEPT = 'Quarterly revenue rose 12 percent.';

beforeEach(() => {
  vi.mocked(readKeptText).mockReset();
  vi.mocked(readKeptText).mockResolvedValue(KEPT);
});

async function readOnDemand(rows: FileRow[], storageId = REF) {
  const { readFileTextOnDemand } = await import('./service.ts');
  const { sql, statements } = fakeSql(rows, storageId);
  const result = await readFileTextOnDemand(sql, {
    organizationId: 'org_1',
    storageId,
  });
  return { result, statements };
}

describe('readFileTextOnDemand', () => {
  it('serves the text a read kept while the index is queued [CHAT-R48]', async () => {
    const { result, statements } = await readOnDemand([row()]);
    expect(result).toEqual({
      kind: 'text',
      filename: 'report.pdf',
      text: KEPT,
      indexing: { status: 'queued' },
    });
    // The text comes from the organization's knowledge database; the app
    // database holds where the read stands, never the text.
    expect(readKeptText).toHaveBeenCalledWith('acme', REF);
    expect(statements[0]).not.toContain('text_content');
  });

  it('serves it while the index runs, and after the index failed on its own side', async () => {
    for (const ragStatus of ['running', 'failed']) {
      const { result } = await readOnDemand([
        row({ ragStatus, ragErrorCode: 'embedding_upstream' }),
      ]);
      expect(result).toMatchObject({ kind: 'text', text: KEPT });
    }
  });

  it('says a read is still running, without reading anything itself', async () => {
    for (const textStatus of ['queued', 'running']) {
      const { result, statements } = await readOnDemand([row({ textStatus })]);
      expect(result).toMatchObject({ kind: 'unreadable', reason: 'pending' });
      expect(statements).toHaveLength(1);
    }
    expect(readKeptText).not.toHaveBeenCalled();
  });

  it.each([
    ['secret_detected', 'secret-detected'],
    ['pii_blocked', 'pii-blocked'],
  ])(
    'lets an index refusal (%s) outrank a read that let the text through',
    async (code, refusal) => {
      const { result } = await readOnDemand([
        row({ ragStatus: 'failed', ragErrorCode: code }),
      ]);
      expect(result).toMatchObject({
        kind: 'unreadable',
        reason: 'refused',
        refusal,
      });
      expect(readKeptText).not.toHaveBeenCalled();
    },
  );

  it('serves a read that ran after the index could not scan the file', async () => {
    const { result } = await readOnDemand([
      row({ ragStatus: 'failed', ragErrorCode: 'pii_scan_failed' }),
    ]);
    expect(result).toMatchObject({ kind: 'text', text: KEPT });
  });

  it('answers a ready read whose kept text is gone as unread', async () => {
    vi.mocked(readKeptText).mockResolvedValue(null);
    const { result } = await readOnDemand([row()]);
    expect(result).toMatchObject({ kind: 'unread', filename: 'report.pdf' });
  });

  it.each([
    ['secret_detected', 'secret-detected'],
    ['pii_blocked', 'pii-blocked'],
    ['pii_scan_failed', 'pii-scan-failed'],
  ])('states a read the organization refused (%s)', async (code, refusal) => {
    const { result } = await readOnDemand([
      row({ textStatus: 'refused', textErrorCode: code }),
    ]);
    expect(result).toMatchObject({
      kind: 'unreadable',
      reason: 'refused',
      refusal,
    });
  });

  it.each([
    ['empty', 'no_text'],
    ['not_text', 'no_text'],
    ['malformed', 'malformed'],
    ['unsupported_type', 'binary'],
  ])('states a read that found no text (%s → %s)', async (code, reason) => {
    const { result } = await readOnDemand([
      row({ textStatus: 'unreadable', textErrorCode: code }),
    ]);
    expect(result).toMatchObject({ kind: 'unreadable', reason });
  });

  it.each([
    ['too_large', 'too_large'],
    ['too_much_text', 'too_much_text'],
    ['read_failed', 'read_failed'],
  ])(
    'states a read that left the file to its index (%s)',
    async (code, reason) => {
      const { result } = await readOnDemand([
        row({
          textStatus: 'deferred',
          textErrorCode: code,
          ragStatus: 'running',
        }),
      ]);
      expect(result).toMatchObject({
        kind: 'unreadable',
        reason,
        indexing: { status: 'running' },
        heldByDocument: false,
        extractable: true,
      });
    },
  );

  it('lets the indexer’s own verdict stand for a file no read decided', async () => {
    const { result } = await readOnDemand([
      row({
        textStatus: null,
        ragStatus: 'failed',
        ragErrorCode: 'secret_detected',
      }),
    ]);
    expect(result).toMatchObject({
      kind: 'unreadable',
      reason: 'refused',
      refusal: 'secret-detected',
    });
  });

  it('answers a readable file nothing has read yet as unread, with its index state', async () => {
    // A REST-bound project file skips indexing by default.
    const { result } = await readOnDemand([
      row({
        fileName: 'lead-verify.txt',
        contentType: 'text/plain',
        skipRagIndexing: true,
        ragStatus: null,
        heldByDocument: true,
        textStatus: null,
      }),
    ]);
    expect(result).toEqual({
      kind: 'unread',
      filename: 'lead-verify.txt',
      indexing: { status: 'skipped' },
    });
  });

  it('answers a read whose text went with a completed index as unread again', async () => {
    // The corpus serves an indexed file; the lane is reached only when the
    // corpus has lost it, and a fresh read is the way back.
    vi.mocked(readKeptText).mockResolvedValue(null);
    const { result } = await readOnDemand([row({ ragStatus: 'completed' })]);
    expect(result).toMatchObject({ kind: 'unread', filename: 'report.pdf' });
  });

  it('serves the text a fresh read kept for a completed file the corpus lost', async () => {
    const { result } = await readOnDemand([row({ ragStatus: 'completed' })]);
    expect(result).toMatchObject({ kind: 'text', text: KEPT });
  });

  it('answers a type no extractor reads as binary, never as unread', async () => {
    const { result } = await readOnDemand([
      row({
        fileName: 'minutes.doc',
        contentType: 'application/msword',
        ragStatus: null,
        textStatus: null,
      }),
    ]);
    expect(result).toMatchObject({
      kind: 'unreadable',
      reason: 'binary',
      extractable: false,
    });
  });

  it('answers a picture with its stored type and size', async () => {
    const { result } = await readOnDemand([
      row({
        fileName: 'png-test-file.png',
        contentType: 'image/png',
        size: 15_189,
        ragStatus: null,
        textStatus: null,
      }),
    ]);
    expect(result).toEqual({
      kind: 'image',
      filename: 'png-test-file.png',
      contentType: 'image/png',
      sizeBytes: 15_189,
    });
  });

  it('reads a trashed row, and a missing one, as nothing', async () => {
    expect(
      (await readOnDemand([row({ lifecycleStatus: 'trashed' })])).result,
    ).toBeNull();
    expect((await readOnDemand([])).result).toBeNull();
  });
});
