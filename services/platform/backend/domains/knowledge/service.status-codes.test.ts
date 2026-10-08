// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { indexWholeDocument } from '../../core/knowledge/indexing.ts';
import {
  RAG_ERROR_EMBEDDING_NOT_CONFIGURED,
  RAG_ERROR_EMBEDDING_PROVIDER_REFUSED,
  RAG_ERROR_EMBEDDING_UPSTREAM,
  RAG_ERROR_EMPTY,
  RAG_ERROR_IMAGE_NO_VISION,
  RAG_ERROR_INDEXER_ERROR,
  RAG_ERROR_MALFORMED,
  RAG_ERROR_NOT_TEXT,
  RAG_ERROR_PII_BLOCKED,
  RAG_ERROR_SECRET_DETECTED,
  RAG_ERROR_UNSUPPORTED_TYPE,
} from '../../core/knowledge/rag_error_codes.ts';
import { ExtractionError } from '../../core/lib/knowledge/extraction/errors.ts';
import {
  indexUploadedFile,
  markRagUnsupportedIfNoExtractor,
} from './service.ts';

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

function fakeSql(log: Query[], fileName = 'refunds.txt'): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$');
    log.push({ text, values });
    if (text.includes('FROM app.file_metadata WHERE id')) {
      return Promise.resolve([
        {
          organizationId: 'org-1',
          storageRef: 's3:org-1/blob-1',
          fileName,
          contentType: 'text/plain',
          documentId: null,
          skipRagIndexing: null,
        },
      ]);
    }
    if (text.includes('FROM "organization"')) {
      return Promise.resolve([{ slug: 'acme' }]);
    }
    if (text.includes('AS "corpusLive"')) {
      // The ref is still referenced — the liveness gate lets the run proceed.
      return Promise.resolve([
        { ref: 's3:org-1/blob-1', corpusLive: true, blobLive: true },
      ]);
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
  it('lands a file no extractor reads on `unsupported` with `unsupported_type` before any work [KNOW-R7]', async () => {
    const log: Query[] = [];
    await indexUploadedFile(fakeSql(log, 'standup.loop'), 'file-1');
    const write = lastStatusWrite(log);
    expect(write).toContain('unsupported');
    expect(write).toContain(RAG_ERROR_UNSUPPORTED_TYPE);
    // The same sentence a sync import writes when it decides this itself.
    expect(write).toContain('No text extractor exists for "standup.loop".');
    const statuses = log
      .filter((query) => query.text.includes('UPDATE app.file_metadata'))
      .flatMap((query) => query.values);
    expect(statuses).not.toContain('running');
    expect(indexWholeDocument).not.toHaveBeenCalled();
  });

  it('lands an empty file on the terminal `unsupported` with `empty`, never `failed` [KNOW-R7]', async () => {
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
    'keeps a %s policy refusal on `failed` with its code (a retry is meaningful) [KNOW-R8] [KNOW-R9]',
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
    'lands an extractor’s %s refusal on `unsupported` with its code and does NOT rethrow [KNOW-R7]',
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

  it('stops without a failure status when its job is cancelled, so the retry resumes the document', async () => {
    // pg-boss cancels the job's signal for two reasons — the job ran past
    // its time budget, or the worker is shutting down — and fails the job
    // either way, so its retry picks the document up. The message names
    // both and stays the same for every file, so the reports group.
    const messages: string[] = [];
    for (const fileId of ['file-1', 'file-2']) {
      const controller = new AbortController();
      vi.mocked(indexWholeDocument).mockImplementation(async (args) => {
        expect(args.signal).toBe(controller.signal);
        controller.abort();
        throw new DOMException('This operation was aborted', 'AbortError');
      });
      const log: Query[] = [];

      const error = await indexUploadedFile(fakeSql(log), fileId, {
        signal: controller.signal,
      }).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(Error);
      messages.push(error instanceof Error ? error.message : '');

      const statuses = log
        .filter((query) => query.text.includes('UPDATE app.file_metadata'))
        .flatMap((query) => query.values);
      expect(statuses).toContain('running');
      expect(statuses).not.toContain('failed');
    }
    expect(messages[0]).toMatch(/time budget/);
    expect(messages[0]).toMatch(/shutting down/);
    expect(messages[0]).not.toContain('file-');
    expect(messages[1]).toBe(messages[0]);
    expect(console.error).not.toHaveBeenCalled();
  });

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

// The suites above and beside this one name each code by its constant. The
// domain spec and the API reference print the words, so the words are held
// here: a renamed code fails this instead of leaving both out of date.
describe('the indexing codes, as the domain spec prints them', () => {
  it('spells each code a rule states [KNOW-R7] [KNOW-R8] [KNOW-R9] [KNOW-R10] [KNOW-R12]', () => {
    expect({
      RAG_ERROR_UNSUPPORTED_TYPE,
      RAG_ERROR_IMAGE_NO_VISION,
      RAG_ERROR_EMPTY,
      RAG_ERROR_NOT_TEXT,
      RAG_ERROR_MALFORMED,
      RAG_ERROR_SECRET_DETECTED,
      RAG_ERROR_PII_BLOCKED,
      RAG_ERROR_EMBEDDING_NOT_CONFIGURED,
      RAG_ERROR_EMBEDDING_PROVIDER_REFUSED,
      RAG_ERROR_EMBEDDING_UPSTREAM,
    }).toEqual({
      RAG_ERROR_UNSUPPORTED_TYPE: 'unsupported_type',
      RAG_ERROR_IMAGE_NO_VISION: 'image_no_vision',
      RAG_ERROR_EMPTY: 'empty',
      RAG_ERROR_NOT_TEXT: 'not_text',
      RAG_ERROR_MALFORMED: 'malformed',
      RAG_ERROR_SECRET_DETECTED: 'secret_detected',
      RAG_ERROR_PII_BLOCKED: 'pii_blocked',
      RAG_ERROR_EMBEDDING_NOT_CONFIGURED: 'embedding_not_configured',
      RAG_ERROR_EMBEDDING_PROVIDER_REFUSED: 'embedding_provider_refused',
      RAG_ERROR_EMBEDDING_UPSTREAM: 'embedding_upstream',
    });
  });
});

describe('markRagUnsupportedIfNoExtractor — a lane that stores a file without queueing it', () => {
  it.each(['standup.loop', 'minutes.doc', 'bundle.zip'])(
    'lands %s on `unsupported` with the indexer’s sentence and code',
    async (fileName) => {
      const log: Query[] = [];
      await expect(
        markRagUnsupportedIfNoExtractor(fakeSql(log), 'file-1', fileName),
      ).resolves.toBe(true);
      expect(lastStatusWrite(log)).toEqual(
        expect.arrayContaining([
          'unsupported',
          `No text extractor exists for "${fileName}".`,
          RAG_ERROR_UNSUPPORTED_TYPE,
          'file-1',
        ]),
      );
    },
  );

  // A `.log` is read by the text extractor but not indexed by itself: a
  // Reindex of it succeeds, so it must never read as terminal on any lane.
  it.each(['server.log', 'minutes.docx'])(
    'writes nothing for %s, which an extractor reads',
    async (fileName) => {
      const log: Query[] = [];
      await expect(
        markRagUnsupportedIfNoExtractor(fakeSql(log), 'file-1', fileName),
      ).resolves.toBe(false);
      expect(log).toEqual([]);
    },
  );
});
