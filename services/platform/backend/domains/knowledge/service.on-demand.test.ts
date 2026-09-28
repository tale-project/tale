// @vitest-environment node

/**
 * The on-demand text lane behind `rag_fetch`
 * (`file_metadata/internal_queries:readTextOnDemandForAgent`). Admission is
 * the caller's; what is pinned here is the lane itself: only the plain-text
 * extractor's extensions are served, the 4 MiB cap holds on the recorded size
 * AND on the bytes that arrive, a trashed row or a key outside the org's
 * namespace reads as nothing, and the true indexing state rides every answer.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ON_DEMAND_TEXT_MAX_BYTES } from '../../core/knowledge/document_text.ts';

const locateOrgObjectStoreMock = vi.fn();
vi.mock('../../lib/object-store.ts', () => ({
  locateOrgObjectStore: (...args: unknown[]) =>
    locateOrgObjectStoreMock(...args),
}));

const getBytesMock = vi.fn();
vi.mock('../../core/lib/storage/object_store.ts', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    s3GetObjectBytesIfExists: (...args: unknown[]) => getBytesMock(...args),
  };
});

vi.mock('../../lib/org-config.ts', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    resolveOrgSlug: () => Promise.resolve('acme'),
  };
});

interface FileRow {
  fileName: string;
  size: number;
  lifecycleStatus: string | null;
  skipRagIndexing: boolean | null;
  ragStatus: string | null;
  ragError: string | null;
  ragErrorCode: string | null;
  heldByDocument: boolean;
}

/** Scripted `sql`: the one file-row read the lane makes. The trashed filter
 * is part of the statement, so the script applies it too. `unsafe` hands the
 * list probe back as its text, so a statement shows it among its values. */
function fakeSql(
  rows: FileRow[],
  storageId: string,
): { sql: Sql; statements: string[]; values: unknown[][] } {
  const statements: string[] = [];
  const values: unknown[][] = [];
  const fn = (strings: TemplateStringsArray, ...args: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push(text);
    values.push(args);
    if (text.includes('FROM app.file_metadata')) {
      expect(args.slice(-2)).toEqual(['org_1', storageId]);
      return Promise.resolve(
        rows.filter((entry) => entry.lifecycleStatus !== 'trashed'),
      );
    }
    throw new Error(`unexpected statement: ${text}`);
  };
  const sql = Object.assign(fn, { unsafe: (raw: string) => raw });
  return { sql: sql as unknown as Sql, statements, values };
}

const REF = 's3:tale/acme/lead-verify.txt';

function row(over: Partial<FileRow> = {}): FileRow {
  return {
    fileName: 'lead-verify.txt',
    size: 42,
    lifecycleStatus: null,
    skipRagIndexing: true,
    ragStatus: null,
    ragError: null,
    ragErrorCode: null,
    heldByDocument: true,
    ...over,
  };
}

async function readOnDemand(rows: FileRow[], storageId = REF) {
  const { readFileTextOnDemand } = await import('./service.ts');
  const { sql, statements, values } = fakeSql(rows, storageId);
  const result = await readFileTextOnDemand(sql, {
    organizationId: 'org_1',
    storageId,
  });
  return { result, statements, values };
}

beforeEach(() => {
  vi.clearAllMocks();
  locateOrgObjectStoreMock.mockResolvedValue({ bucket: 'tale' });
  getBytesMock.mockResolvedValue(new TextEncoder().encode('lead: verified'));
});

describe('readFileTextOnDemand', () => {
  it('decodes a text-like file and reports its (skipped) indexing state', async () => {
    const { result } = await readOnDemand([row()]);
    expect(result).toEqual({
      kind: 'text',
      filename: 'lead-verify.txt',
      text: 'lead: verified',
      indexing: { status: 'skipped' },
    });
    // The key is read from the store that holds it, never a hard-wired one.
    expect(locateOrgObjectStoreMock).toHaveBeenCalledWith(
      'acme',
      'tale/acme/lead-verify.txt',
    );
  });

  it('answers null for a ref no live row holds — trashed included', async () => {
    expect((await readOnDemand([])).result).toBeNull();
    expect(
      (await readOnDemand([row({ lifecycleStatus: 'trashed' })])).result,
    ).toBeNull();
    expect(getBytesMock).not.toHaveBeenCalled();
  });

  it('refuses a binary file before any byte is fetched, carrying its state', async () => {
    const { result } = await readOnDemand([
      row({
        fileName: 'scan.pdf',
        skipRagIndexing: false,
        ragStatus: 'failed',
        ragError: 'Embedding provider refused',
        ragErrorCode: 'embedding_provider_refused',
      }),
    ]);
    expect(result).toEqual({
      kind: 'unreadable',
      filename: 'scan.pdf',
      sizeBytes: 42,
      indexing: { status: 'failed', error: 'Embedding provider refused' },
      heldByDocument: true,
      extractable: true,
      reason: 'binary',
    });
    expect(locateOrgObjectStoreMock).not.toHaveBeenCalled();
    expect(getBytesMock).not.toHaveBeenCalled();
  });

  // Only a document can be indexed by hand; the miss must know which one it
  // is answering for, or it sends the model to a door an attachment lacks.
  it('says whether a document holds the file, by the lists’ own join', async () => {
    const { result, values } = await readOnDemand([
      row({ fileName: 'minutes.doc', heldByDocument: false }),
    ]);
    expect(result).toMatchObject({
      kind: 'unreadable',
      heldByDocument: false,
      reason: 'binary',
    });
    const { HELD_BY_DOCUMENT_SQL } = await import('./status-hints.ts');
    expect(values[0]).toContain(HELD_BY_DOCUMENT_SQL);
  });

  // An index run on a `.doc` or an image can only end `unsupported`, so the
  // miss must not send the model to one — a document's included.
  it.each([
    ['minutes.doc', false],
    ['bundle.zip', false],
    ['photo.png', false],
    ['SCAN.JPG', false],
    ['deck.pptx', true],
    ['scan.pdf', true],
  ])(
    'says whether an index run could read %s: %s',
    async (fileName, extractable) => {
      const { result } = await readOnDemand([row({ fileName })]);
      expect(result).toMatchObject({
        kind: 'unreadable',
        heldByDocument: true,
        extractable,
        reason: 'binary',
      });
    },
  );

  it('holds the cap on the recorded size before fetching', async () => {
    const { result } = await readOnDemand([
      row({ fileName: 'dump.csv', size: ON_DEMAND_TEXT_MAX_BYTES + 1 }),
    ]);
    expect(result).toMatchObject({ kind: 'unreadable', reason: 'too_large' });
    expect(getBytesMock).not.toHaveBeenCalled();
  });

  it('holds the cap on the bytes that actually arrive', async () => {
    getBytesMock.mockResolvedValueOnce(
      new Uint8Array(ON_DEMAND_TEXT_MAX_BYTES + 1),
    );
    const { result } = await readOnDemand([row({ size: 10 })]);
    expect(result).toMatchObject({ kind: 'unreadable', reason: 'too_large' });
  });

  it('reads empty or missing bytes as no text, never as an empty document', async () => {
    getBytesMock.mockResolvedValueOnce(null);
    expect((await readOnDemand([row()])).result).toMatchObject({
      kind: 'unreadable',
      reason: 'no_text',
    });
    getBytesMock.mockResolvedValueOnce(new TextEncoder().encode('  \n'));
    expect((await readOnDemand([row()])).result).toMatchObject({
      kind: 'unreadable',
      reason: 'no_text',
    });
  });

  it('never fetches a key outside the organization’s namespace', async () => {
    const foreign = 's3:tale/other-org/lead-verify.txt';
    const { result } = await readOnDemand([row()], foreign);
    expect(result).toMatchObject({ kind: 'unreadable', reason: 'no_text' });
    expect(locateOrgObjectStoreMock).not.toHaveBeenCalled();
  });
});
