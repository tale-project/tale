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
}

/** Scripted `sql`: the one file-row read the lane makes. The trashed filter
 * is part of the statement, so the script applies it too. */
function fakeSql(
  rows: FileRow[],
  storageId: string,
): { sql: Sql; statements: string[] } {
  const statements: string[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push(text);
    if (text.includes('FROM app.file_metadata')) {
      expect(values.slice(0, 2)).toEqual(['org_1', storageId]);
      return Promise.resolve(
        rows.filter((entry) => entry.lifecycleStatus !== 'trashed'),
      );
    }
    throw new Error(`unexpected statement: ${text}`);
  };
  return { sql: fn as unknown as Sql, statements };
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
    ...over,
  };
}

async function readOnDemand(rows: FileRow[], storageId = REF) {
  const { readFileTextOnDemand } = await import('./service.ts');
  const { sql, statements } = fakeSql(rows, storageId);
  const result = await readFileTextOnDemand(sql, {
    organizationId: 'org_1',
    storageId,
  });
  return { result, statements };
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
      reason: 'binary',
    });
    expect(locateOrgObjectStoreMock).not.toHaveBeenCalled();
    expect(getBytesMock).not.toHaveBeenCalled();
  });

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
