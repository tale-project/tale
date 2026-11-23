// @vitest-environment node

/**
 * An upload's index run starts from the text its read checked
 * (`read-text.ts`), and has the last word on that kept text.
 *
 * The read hands the index run on once it is decided, so the two never
 * extract one file at once: a run that finds the read ready takes its text
 * from the organization's knowledge database (`core/knowledge/
 * kept_reads.ts`) and has the heavy slot prepare that text — no bytes
 * fetched, no extraction, no second secret scan of the same bytes — and the
 * PII policy is applied to it again as to every text. A completed index serves the text itself, so the kept copy goes; an
 * index the policy in force refuses refuses the read too, and its text goes
 * with it. A run with no kept read — or one that cannot fetch it — reads the
 * file itself, and settling the read never fails the index it closes.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { memoryLimitSentence } from '../../../lib/shared/memory-limit.ts';
import { indexWholeDocument } from '../../core/knowledge/indexing.ts';
import { dropKeptText, readKeptText } from '../../core/knowledge/kept_reads.ts';
import {
  chunksInMemory,
  type PreparedDocument,
} from '../../core/knowledge/prepare.ts';
import { prepareInHeavySlot } from '../../lib/heavy-slot/documents.ts';
import { HeavyLimitError } from '../../lib/heavy-slot/slot.ts';
import { indexUploadedFile } from './service.ts';

vi.mock('../../core/knowledge/indexing.ts', () => ({
  indexWholeDocument: vi.fn(),
}));
vi.mock('../../core/knowledge/kept_reads.ts', () => ({
  keepReadText: vi.fn(),
  readKeptText: vi.fn(),
  dropKeptText: vi.fn(),
}));
vi.mock('../../lib/heavy-slot/documents.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../lib/heavy-slot/documents.ts')
  >()),
  prepareInHeavySlot: vi.fn(),
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

/** What the heavy slot made ready, and the call that lets go of it. */
const prepared: PreparedDocument = {
  kind: 'ready',
  contentHash: 'hash-of-the-text',
  filename: 'report.pdf',
  chunks: chunksInMemory([], new Set()),
};
const release = vi.fn(async () => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(indexWholeDocument).mockResolvedValue(done);
  vi.mocked(readKeptText).mockResolvedValue('Checked text.');
  vi.mocked(dropKeptText).mockResolvedValue(undefined);
  vi.mocked(prepareInHeavySlot).mockImplementation(async (source) => ({
    // Only a file that was read says something of itself.
    facts: source.kind === 'text' ? null : { visionUsed: false, pageCount: 3 },
    prepared,
    release,
  }));
});

describe('an index run starts from its upload’s read [KNOW-R21]', () => {
  it('takes the kept text: no bytes fetched, nothing extracted or scanned twice', async () => {
    const log: Query[] = [];
    await indexUploadedFile(fakeSql(log, true), 'file-1');

    expect(readKeptText).toHaveBeenCalledWith('acme', REF);
    // The text as it was kept, and not the file: its bytes passed the
    // secret scan when they were read, and nothing reads them again.
    expect(prepareInHeavySlot).toHaveBeenCalledTimes(1);
    const [source, fileName, call] =
      vi.mocked(prepareInHeavySlot).mock.calls[0] ?? [];
    expect(source).toEqual({ kind: 'text', text: 'Checked text.' });
    expect(fileName).toBe('report.pdf');
    // The policy is applied again, as to every text; and the work waits
    // behind what a person is waiting for.
    expect(call).toMatchObject({ piiConfig: null, priority: 'background' });
    // What the slot made ready is what is indexed.
    const args = vi.mocked(indexWholeDocument).mock.calls[0]?.[0];
    expect(args?.prepared).toBe(prepared);
    expect(args?.text).toBeUndefined();
    // Nothing was read off the file, so nothing is stamped on its row.
    expect(
      log.some((query) => query.text.includes('scanned_pages_detected')),
    ).toBe(false);
  });

  it('reads the file itself when no read is ready', async () => {
    const log: Query[] = [];
    await indexUploadedFile(fakeSql(log, false), 'file-1');

    expect(readKeptText).not.toHaveBeenCalled();
    expect(prepareInHeavySlot).toHaveBeenCalledTimes(1);
    const [source] = vi.mocked(prepareInHeavySlot).mock.calls[0] ?? [];
    expect(source).toMatchObject({ kind: 'store', key: 'org-1/blob-1' });
    expect(vi.mocked(indexWholeDocument).mock.calls[0]?.[0].prepared).toBe(
      prepared,
    );
    // What reading the file learned of it is on its row before it is
    // embedded.
    const stamped = log.find((query) =>
      query.text.includes('scanned_pages_detected'),
    );
    expect(stamped?.values).toContain(3);
  });

  it('reads the file itself when the kept text is gone, or cannot be fetched', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(readKeptText).mockResolvedValueOnce(null);
    await indexUploadedFile(fakeSql([], true), 'file-1');
    vi.mocked(readKeptText).mockRejectedValueOnce(new Error('knowledge down'));
    await indexUploadedFile(fakeSql([], true), 'file-1');

    expect(
      vi.mocked(prepareInHeavySlot).mock.calls.map(([source]) => source.kind),
    ).toEqual(['store', 'store']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not be fetched'),
      expect.objectContaining({ fileId: 'file-1' }),
    );
  });

  it('lets go of what the slot made ready, however the run ends', async () => {
    await indexUploadedFile(fakeSql([], true), 'file-1');
    expect(release).toHaveBeenCalledTimes(1);

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(indexWholeDocument).mockRejectedValueOnce(
      Object.assign(new Error('upstream 503'), { status: 503 }),
    );
    await expect(
      indexUploadedFile(fakeSql([], true), 'file-1'),
    ).rejects.toThrow('upstream 503');
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("passes its job's signal on, so that a cancelled job stops waiting for a slot", async () => {
    const job = new AbortController();
    await indexUploadedFile(fakeSql([], false), 'file-1', {
      signal: job.signal,
    });
    expect(vi.mocked(prepareInHeavySlot).mock.calls[0]?.[2]).toMatchObject({
      signal: job.signal,
    });
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

describe('a file that needs more memory than one file is given [KNOW-R22]', () => {
  /** The last write of the file's indexing status. */
  const lastStatusWrite = (log: Query[]): unknown[] =>
    log.findLast(
      (q) =>
        q.text.includes('UPDATE app.file_metadata') &&
        q.text.includes('rag_status = coalesce'),
    )?.values ?? [];

  it.each([
    ['the file itself', false],
    ['the text its read kept', true],
  ])(
    'fails with the limit and the setting on its row, reading %s',
    async (_what, ready) => {
      vi.mocked(prepareInHeavySlot).mockRejectedValue(new HeavyLimitError(96));
      const log: Query[] = [];
      // No rethrow: the same file meets the same limit, so the job's
      // retries would only read it again.
      await expect(
        indexUploadedFile(fakeSql(log, ready), 'file-1'),
      ).resolves.toBeUndefined();

      const write = lastStatusWrite(log);
      expect(write).toContain('failed');
      expect(write).toContain('memory_limit');
      expect(write).toContain(memoryLimitSentence(96));
      expect(memoryLimitSentence(96)).toContain('96 MiB');
      expect(memoryLimitSentence(96)).toContain('HEAVY_SLOT_MEMORY_MB');
      // Nothing of it is indexed.
      expect(indexWholeDocument).not.toHaveBeenCalled();
    },
  );

  it('keeps the text its read checked, for the retry after the limit is raised', async () => {
    vi.mocked(prepareInHeavySlot).mockRejectedValue(new HeavyLimitError(96));
    const log: Query[] = [];
    await indexUploadedFile(fakeSql(log, true), 'file-1');
    expect(dropKeptText).not.toHaveBeenCalled();
    expect(readStatusWrites(log)).toEqual([]);
  });
});
