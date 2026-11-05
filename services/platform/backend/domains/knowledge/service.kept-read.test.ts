// @vitest-environment node

/**
 * An upload's index run starts from the text its read checked
 * (`read-text.ts`), and has the last word on that kept text.
 *
 * The read hands the index run on once it is decided, so the two never
 * extract one file at once: a run that finds the read ready takes its text
 * from the organization's knowledge database (`core/knowledge/
 * kept_reads.ts`) — no bytes fetched, no extraction, no second secret scan
 * of the same bytes — and the PII policy is applied to it again as to every
 * text. A completed index serves the text itself, so the kept copy goes; an
 * index the policy in force refuses refuses the read too, and its text goes
 * with it. A run with no kept read — or one that cannot fetch it — reads the
 * file itself, and settling the read never fails the index it closes.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { indexWholeDocument } from '../../core/knowledge/indexing.ts';
import { dropKeptText, readKeptText } from '../../core/knowledge/kept_reads.ts';
import { extractDocument } from '../../core/lib/knowledge/extraction/router.ts';
import { s3GetObjectBytes } from '../../core/lib/storage/object_store.ts';
import { indexUploadedFile } from './service.ts';

vi.mock('../../core/knowledge/indexing.ts', () => ({
  indexWholeDocument: vi.fn(),
}));
vi.mock('../../core/knowledge/kept_reads.ts', () => ({
  keepReadText: vi.fn(),
  readKeptText: vi.fn(),
  dropKeptText: vi.fn(),
}));
vi.mock(
  '../../core/lib/knowledge/extraction/router.ts',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../../core/lib/knowledge/extraction/router.ts')
    >()),
    extractDocument: vi.fn(async () => ({ text: 'Extracted here.' })),
  }),
);
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
vi.mock('../../core/lib/storage/object_store.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/lib/storage/object_store.ts')
  >()),
  s3GetObjectBytes: vi.fn(async () => Buffer.from('%PDF-1.7')),
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

/** Scripted `sql`: the file row, whether its read is ready, the liveness
 * gate, and every write logged. */
function fakeSql(log: Query[], ready: boolean): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$').replace(/\s+/g, ' ');
    log.push({ text, values });
    if (text.includes('SELECT true AS ready')) {
      return Promise.resolve(ready ? [{ ready: true }] : []);
    }
    if (text.includes('FROM app.file_metadata WHERE id')) {
      return Promise.resolve([
        {
          organizationId: 'org-1',
          storageRef: 's3:org-1/blob-1',
          fileName: 'report.pdf',
          contentType: 'application/pdf',
          documentId: null,
          skipRagIndexing: null,
        },
      ]);
    }
    if (text.includes('FROM "organization"')) {
      return Promise.resolve([{ slug: 'acme' }]);
    }
    if (text.includes('AS "corpusLive"')) {
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

const done = {
  fileId: 's3:org-1/blob-1',
  chunksWritten: 1,
  chunksTotal: 1,
  chunksStored: 1,
  partial: false,
};

/** The writes to the read's status on the file row. */
const readStatusWrites = (log: Query[]) =>
  log.filter(
    (q) =>
      q.text.includes('UPDATE app.file_metadata') &&
      q.text.includes('text_status ='),
  );

const REF = 's3:org-1/blob-1';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(indexWholeDocument).mockResolvedValue(done);
  vi.mocked(readKeptText).mockResolvedValue('Checked text.');
  vi.mocked(dropKeptText).mockResolvedValue(undefined);
});

describe('an index run starts from its upload’s read [KNOW-R21]', () => {
  it('takes the kept text: no bytes fetched, nothing extracted or scanned twice', async () => {
    const log: Query[] = [];
    await indexUploadedFile(fakeSql(log, true), 'file-1');

    expect(readKeptText).toHaveBeenCalledWith('acme', REF);
    expect(s3GetObjectBytes).not.toHaveBeenCalled();
    expect(extractDocument).not.toHaveBeenCalled();
    const args = vi.mocked(indexWholeDocument).mock.calls[0]?.[0];
    expect(args?.text).toBe('Checked text.');
    // The bytes passed the secret scan when they were read.
    expect(args?.bytes).toBeUndefined();
    // The policy is applied again, as to every text.
    expect(args).toHaveProperty('piiConfig');
  });

  it('reads the file itself when no read is ready', async () => {
    const log: Query[] = [];
    await indexUploadedFile(fakeSql(log, false), 'file-1');

    expect(readKeptText).not.toHaveBeenCalled();
    expect(s3GetObjectBytes).toHaveBeenCalledTimes(1);
    expect(extractDocument).toHaveBeenCalledTimes(1);
    const args = vi.mocked(indexWholeDocument).mock.calls[0]?.[0];
    expect(args?.text).toBe('Extracted here.');
    expect(args?.bytes).toBeInstanceOf(Uint8Array);
  });

  it('reads the file itself when the kept text is gone, or cannot be fetched', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(readKeptText).mockResolvedValueOnce(null);
    await indexUploadedFile(fakeSql([], true), 'file-1');
    vi.mocked(readKeptText).mockRejectedValueOnce(new Error('knowledge down'));
    await indexUploadedFile(fakeSql([], true), 'file-1');

    expect(extractDocument).toHaveBeenCalledTimes(2);
    for (const [args] of vi.mocked(indexWholeDocument).mock.calls) {
      expect(args.text).toBe('Extracted here.');
    }
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not be fetched'),
      expect.objectContaining({ fileId: 'file-1' }),
    );
  });

  it('lets the kept text go once the corpus serves the file', async () => {
    const log: Query[] = [];
    await indexUploadedFile(fakeSql(log, true), 'file-1');

    expect(dropKeptText).toHaveBeenCalledWith('acme', [REF]);
    // A read the policy refused is lifted by an index the policy let
    // through; any other read keeps its status.
    const writes = readStatusWrites(log);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.text).toContain("SET text_status = 'ready'");
    expect(writes[0]?.text).toContain("AND text_status = 'refused'");
    expect(writes[0]?.values).toEqual(['file-1']);
  });

  it.each([
    ['secret-detected', 'secret_detected'],
    ['pii-blocked', 'pii_blocked'],
    ['pii-scan-failed', 'pii_scan_failed'],
  ] as const)(
    'refuses the read with an index the policy in force refuses (%s)',
    async (skipped, code) => {
      vi.mocked(indexWholeDocument).mockResolvedValue({
        ...done,
        chunksWritten: 0,
        skipped,
        refusal: 'Refused.',
      });
      const log: Query[] = [];
      await indexUploadedFile(fakeSql(log, true), 'file-1');

      const writes = readStatusWrites(log);
      expect(writes).toHaveLength(1);
      expect(writes[0]?.text).toContain("SET text_status = 'refused'");
      expect(writes[0]?.values).toEqual([code, 'file-1']);
      expect(dropKeptText).toHaveBeenCalledWith('acme', [REF]);
    },
  );

  it('never fails a completed index over its read’s settle', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(dropKeptText).mockRejectedValue(new Error('knowledge down'));
    const log: Query[] = [];
    await expect(
      indexUploadedFile(fakeSql(log, true), 'file-1'),
    ).resolves.toBeUndefined();

    expect(
      log.some(
        (q) =>
          q.text.includes('UPDATE app.file_metadata') &&
          q.values.includes('failed'),
      ),
    ).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('settling the read of an indexed file failed'),
      expect.objectContaining({ fileId: 'file-1' }),
    );
  });

  it('keeps the read when the index fails on the embedding server', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(indexWholeDocument).mockRejectedValue(
      Object.assign(new Error('upstream 503'), { status: 503 }),
    );
    const log: Query[] = [];
    await expect(
      indexUploadedFile(fakeSql(log, true), 'file-1'),
    ).rejects.toThrow('upstream 503');

    expect(readStatusWrites(log)).toEqual([]);
    expect(dropKeptText).not.toHaveBeenCalled();
  });
});
