// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readOrgEmbeddingConfig } from '../../core/knowledge/connection.ts';
import { indexWholeDocument } from '../../core/knowledge/indexing.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { indexUploadedFile } from './service.ts';

/**
 * A file indexed while an admin saved another embedding model. The save put
 * back in the queue what read as indexed and left this file, then running,
 * to its run — which had read the settings before and embedded the file
 * with the model they stated then. Once the file reads indexed, the run puts
 * it back in the queue when the model's name or its width moved, and leaves
 * it indexed when only the provider changed, or nothing did (`KNOW-R17`).
 */

const STATED = {
  providerSlug: 'openai',
  model: 'text-embedding-3-small',
  dimensions: 1536,
};

vi.mock('../../core/knowledge/indexing.ts', () => ({
  indexWholeDocument: vi.fn(),
}));
vi.mock('../../core/knowledge/embedding.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/knowledge/embedding.ts')
  >()),
  // Built from the settings as the run read them.
  embedderForOrg: vi.fn(async () => ({
    dimensions: STATED.dimensions,
    model: STATED,
  })),
}));
vi.mock('../../core/knowledge/connection.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/knowledge/connection.ts')
  >()),
  readOrgEmbeddingConfig: vi.fn(),
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

const REF = 's3:org-1/blob-1';

/** The app database: one live file row; every statement is logged. With
 * `stillIndexed: false` the file no longer reads indexed when the run would
 * put it back — a save did so already, or its uploader opted out; with
 * `failing`, putting it back fails. */
function fakeSql(
  log: Query[],
  options: { stillIndexed?: boolean; failing?: boolean } = {},
): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$');
    log.push({ text, values });
    if (text.includes('FROM app.file_metadata WHERE id')) {
      return Promise.resolve([
        {
          organizationId: 'org-1',
          storageRef: REF,
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
    if (text.includes('AS "corpusLive"')) {
      return Promise.resolve([{ ref: REF, corpusLive: true, blobLive: true }]);
    }
    if (text.includes("rag_status = 'queued'")) {
      return Promise.resolve(
        options.stillIndexed === false
          ? []
          : [{ orgId: 'org-1', listed: false }],
      );
    }
    if (text.includes('UPDATE app.file_metadata')) {
      return Promise.resolve([{ orgId: 'org-1', listed: false }]);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    unsafe: (t: string) => t,
    begin: (fn: (tx: unknown) => Promise<unknown>) =>
      options.failing === true
        ? Promise.reject(new Error('the database stopped answering'))
        : fn(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return sql as unknown as Sql;
}

/** Where the file was marked indexed, and put back in the queue (-1: never). */
const markedIndexed = (log: Query[]) =>
  log.findIndex((query) => query.values.includes('completed'));
const queuedAgain = (log: Query[]) =>
  log.findIndex((query) => query.text.includes("rag_status = 'queued'"));

/** The settings as the run reads them first, then as a save left them. */
function settings(now: typeof STATED | null) {
  vi.mocked(readOrgEmbeddingConfig)
    .mockResolvedValueOnce(STATED)
    .mockResolvedValue(now);
}

beforeEach(() => {
  vi.mocked(readOrgEmbeddingConfig).mockReset();
  vi.mocked(addJobInTx).mockReset();
  vi.mocked(indexWholeDocument).mockReset();
  vi.mocked(indexWholeDocument).mockResolvedValue({
    fileId: REF,
    chunksWritten: 5,
    chunksTotal: 5,
    chunksStored: 5,
    partial: false,
  });
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

describe('indexUploadedFile — the embedding model moved while it ran [KNOW-R17]', () => {
  it('puts the file back in the queue when the settings name another model', async () => {
    settings({ ...STATED, model: 'openrouter/qwen/qwen3-embedding-8b' });
    const log: Query[] = [];
    await indexUploadedFile(fakeSql(log), 'file-1');

    // Indexed first, then back in the queue: a save that lands in between
    // finds an indexed file and puts it back itself.
    expect(markedIndexed(log)).toBeGreaterThan(-1);
    expect(queuedAgain(log)).toBeGreaterThan(markedIndexed(log));
    // Only while it still reads indexed.
    expect(log[queuedAgain(log)]?.text).toContain(
      "fm.rag_status = 'completed'",
    );
    expect(
      vi.mocked(addJobInTx).mock.calls.map((call) => call.slice(1)),
    ).toEqual([['rag.index_file', { fileId: 'file-1' }]]);
  });

  it('puts the file back in the queue when the settings state another width', async () => {
    settings({ ...STATED, dimensions: 1024 });
    const log: Query[] = [];
    await indexUploadedFile(fakeSql(log), 'file-1');

    expect(queuedAgain(log)).toBeGreaterThan(markedIndexed(log));
  });

  it('does so for a file the run found indexed already, under the old model', async () => {
    vi.mocked(indexWholeDocument).mockResolvedValue({
      fileId: REF,
      chunksWritten: 0,
      chunksTotal: 5,
      chunksStored: 5,
      partial: false,
      skipped: 'unchanged',
    });
    settings({ ...STATED, model: 'openrouter/qwen/qwen3-embedding-8b' });
    const log: Query[] = [];
    await indexUploadedFile(fakeSql(log), 'file-1');

    expect(queuedAgain(log)).toBeGreaterThan(-1);
  });

  // A save put it back while the run marked it indexed, or the uploader
  // opted out: one job is enough, and an opted-out file stays as it is.
  it('queues nothing more for a file that no longer reads indexed', async () => {
    settings({ ...STATED, model: 'openrouter/qwen/qwen3-embedding-8b' });
    const log: Query[] = [];
    await indexUploadedFile(fakeSql(log, { stillIndexed: false }), 'file-1');

    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('never fails the run when the file cannot be put back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    settings({ ...STATED, model: 'openrouter/qwen/qwen3-embedding-8b' });
    const log: Query[] = [];
    await expect(
      indexUploadedFile(fakeSql(log, { failing: true }), 'file-1'),
    ).resolves.toBe(undefined);

    expect(markedIndexed(log)).toBeGreaterThan(-1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('the daily corpus reconcile puts it back'),
      expect.objectContaining({ fileId: 'file-1' }),
    );
    warn.mockRestore();
  });

  // The same model through another provider makes the same vectors.
  it('leaves the file indexed when only the provider changed', async () => {
    settings({ ...STATED, providerSlug: 'bifrost' });
    const log: Query[] = [];
    await indexUploadedFile(fakeSql(log), 'file-1');

    expect(markedIndexed(log)).toBeGreaterThan(-1);
    expect(queuedAgain(log)).toBe(-1);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('leaves the file indexed when the settings still state its model', async () => {
    settings(STATED);
    const log: Query[] = [];
    await indexUploadedFile(fakeSql(log), 'file-1');

    expect(markedIndexed(log)).toBeGreaterThan(-1);
    expect(queuedAgain(log)).toBe(-1);
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});
