// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { indexWholeDocument } from '../../core/knowledge/indexing.ts';
import {
  RAG_ERROR_EMPTY,
  RAG_ERROR_INDEXER_ERROR,
  RAG_ERROR_MALFORMED,
  RAG_ERROR_NOT_TEXT,
  RAG_ERROR_PII_BLOCKED,
  RAG_ERROR_SECRET_DETECTED,
} from '../../core/knowledge/rag_error_codes.ts';
import { ExtractionError } from '../../core/lib/knowledge/extraction/errors.ts';
import { indexUploadedFile } from './service.ts';

/**
 * Every real indexing failure lands with a stable `errorCode` and an honest
 * status: a poller branches on the code ("retry", "tell the user to
 * re-export", "give up"), never on a sentence — and a terminal cause lands on
 * `unsupported` without a rethrow, so the job's retry ladder does not
 * re-download and re-embed bytes that can never index (2026-09-14
 * evaluation, g3-1 / g3-2 / g3-6). The raw error text never reaches the
 * row: it goes to the platform log.
 */

vi.mock('../../core/knowledge/indexing.ts', () => ({
  indexWholeDocument: vi.fn(),
}));
vi.mock('../../core/knowledge/embedding.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/knowledge/embedding.ts')
  >()),
  embedderForOrg: vi.fn(async () => ({ dimensions: 3 })),
}));
vi.mock('../../core/knowledge/connection.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/knowledge/connection.ts')
  >()),
  readOrgEmbeddingConfig: vi.fn(async () => ({
    providerSlug: 'openai',
    model: 'text-embedding-3-small',
    dimensions: 3,
  })),
}));
vi.mock('../../core/knowledge/pool.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/knowledge/pool.ts')>()),
  getKnowledgePoolForOrg: vi.fn(async () => ({})),
  resolveOrgUrl: vi.fn(async () => 'postgres://knowledge.example/acme'),
}));
vi.mock('../../core/knowledge/dimensions.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/knowledge/dimensions.ts')
  >()),
  pinDimensions: vi.fn(async () => undefined),
}));
vi.mock('../../core/lib/storage/object_store.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/lib/storage/object_store.ts')
  >()),
  s3GetObjectBytes: vi.fn(async () => Buffer.from('Refund policy: 30 days.')),
}));
vi.mock('../../lib/object-store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/object-store.ts')>()),
  locateOrgObjectStore: vi.fn(async () => ({ bucket: 'tale-blobs' })),
}));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../../jobs/enqueue.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../jobs/enqueue.ts')>()),
  addJobInTx: vi.fn(),
}));

interface Query {
  text: string;
  values: unknown[];
}

function fakeSql(log: Query[]): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$');
    log.push({ text, values });
    if (text.includes('FROM app.file_metadata WHERE id')) {
      return Promise.resolve([
        {
          organizationId: 'org-1',
          storageRef: 's3:org-1/blob-1',
          fileName: 'refunds.txt',
          contentType: 'text/plain',
          documentId: null,
          skipRagIndexing: null,
        },
      ]);
    }
    if (text.includes('FROM "organization"')) {
      return Promise.resolve([{ slug: 'acme' }]);
    }
    if (text.includes('UPDATE app.file_metadata')) {
      return Promise.resolve([{ orgId: 'org-1' }]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(tag, { unsafe: (t: string) => t }) as unknown as Sql;
}

/** The last `rag_status` write's bound values. */
const lastStatusWrite = (log: Query[]): unknown[] =>
  log.findLast((q) => q.text.includes('UPDATE app.file_metadata'))?.values ??
  [];

const skipped = (kind: 'empty' | 'secret-detected' | 'pii-blocked') => ({
  fileId: 's3:org-1/blob-1',
  chunksWritten: 0,
  chunksTotal: 0,
  chunksStored: 0,
  partial: false,
  skipped: kind,
  ...(kind === 'empty' ? {} : { refusal: `Refused (${kind}).` }),
});

beforeEach(() => {
  vi.mocked(indexWholeDocument).mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('indexUploadedFile — one stable code per failure', () => {
  it('lands an empty file on the terminal `unsupported` with `empty`, never `failed`', async () => {
    vi.mocked(indexWholeDocument).mockResolvedValue(skipped('empty'));
    const log: Query[] = [];
    await expect(indexUploadedFile(fakeSql(log), 'file-1')).resolves.toBe(
      undefined,
    );
    const write = lastStatusWrite(log);
    expect(write).toContain('unsupported');
    expect(write).toContain(RAG_ERROR_EMPTY);
    expect(write).not.toContain('failed');
  });

  it.each([
    ['secret-detected', RAG_ERROR_SECRET_DETECTED],
    ['pii-blocked', RAG_ERROR_PII_BLOCKED],
  ] as const)(
    'keeps a %s policy refusal on `failed` with its code (a retry is meaningful)',
    async (kind, code) => {
      vi.mocked(indexWholeDocument).mockResolvedValue(skipped(kind));
      const log: Query[] = [];
      await indexUploadedFile(fakeSql(log), 'file-1');
      const write = lastStatusWrite(log);
      expect(write).toContain('failed');
      expect(write).toContain(code);
    },
  );

  it.each([
    ['not_text', RAG_ERROR_NOT_TEXT],
    ['malformed', RAG_ERROR_MALFORMED],
  ] as const)(
    'lands an extractor’s %s refusal on `unsupported` with its code and does NOT rethrow',
    async (code, wire) => {
      vi.mocked(indexWholeDocument).mockRejectedValue(
        new ExtractionError(code, `The file cannot be read (${code}).`),
      );
      const log: Query[] = [];
      // No rethrow: a terminal cause must not burn the job's retries.
      await expect(indexUploadedFile(fakeSql(log), 'file-1')).resolves.toBe(
        undefined,
      );
      const write = lastStatusWrite(log);
      expect(write).toContain('unsupported');
      expect(write).toContain(wire);
      expect(write).toContain(`The file cannot be read (${code}).`);
    },
  );

  it('stores a curated sentence and `indexer_error` for an unclassified fault, never the raw text, and rethrows for the retry ladder', async () => {
    vi.mocked(indexWholeDocument).mockRejectedValue(
      new Error('invalid byte sequence for encoding "UTF8": 0x00'),
    );
    const log: Query[] = [];
    await expect(indexUploadedFile(fakeSql(log), 'file-1')).rejects.toThrow(
      /invalid byte sequence/,
    );
    const write = lastStatusWrite(log);
    expect(write).toContain('failed');
    expect(write).toContain(RAG_ERROR_INDEXER_ERROR);
    // The storage-engine diagnostic stays out of the public row.
    expect(
      write.some(
        (value) =>
          typeof value === 'string' && value.includes('invalid byte sequence'),
      ),
    ).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      '[knowledge] indexing failed',
      expect.objectContaining({ fileId: 'file-1' }),
    );
  });
});
