// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { indexWholeDocument } from '../../core/knowledge/indexing.ts';
import { s3GetObjectBytes } from '../../core/lib/storage/object_store.ts';
import { indexUploadedFile } from './service.ts';

/**
 * A ref nothing references any more is not indexed, and a run whose ref was
 * released while it ran ends quietly.
 *
 * The job outlives the moment that queued it: an agent that rewrites its
 * report two seconds after writing it rotates the document's ref and releases
 * the old one while the job for the old one is still queued or embedding.
 * The old ref must never come back into the corpus — not by a late first
 * attempt, not by a retry after the release landed mid-run — and the release
 * is not a failure: no `failed` status, no rethrow, no retry.
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

const REF = 's3:org-1/blob-1';

/** The app database: one file row, and a liveness verdict the test flips. */
function fakeSql(log: Query[], live: { corpus: boolean }): Sql {
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
      return Promise.resolve([
        { ref: REF, corpusLive: live.corpus, blobLive: live.corpus },
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

/** Every `rag_status` write's bound values. */
const statusWrites = (log: Query[]): unknown[][] =>
  log
    .filter((query) => query.text.includes('UPDATE app.file_metadata'))
    .map((query) => query.values);

const released = {
  fileId: REF,
  chunksWritten: 0,
  chunksTotal: 5,
  chunksStored: 0,
  partial: false,
  skipped: 'released' as const,
};

let info: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(indexWholeDocument).mockReset();
  vi.mocked(s3GetObjectBytes).mockClear();
  info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('indexUploadedFile — a released ref', () => {
  it('indexes nothing for a file whose ref nothing references any more', async () => {
    const log: Query[] = [];
    await expect(
      indexUploadedFile(fakeSql(log, { corpus: false }), 'file-1'),
    ).resolves.toBe(undefined);

    // Decided before any bytes are fetched or any status is written: the row
    // is out of circulation and a marker on it is read by nobody.
    expect(s3GetObjectBytes).not.toHaveBeenCalled();
    expect(indexWholeDocument).not.toHaveBeenCalled();
    expect(statusWrites(log)).toEqual([]);
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('nothing references the file'),
      { fileId: 'file-1', orgSlug: 'acme' },
    );
    expect(error).not.toHaveBeenCalled();
    // The question is the release seam's own predicate, asked for THIS ref
    // in THIS organization.
    const asked = log.find((query) => query.text.includes('AS "corpusLive"'));
    expect(asked?.values).toContain('org-1');
    expect(asked?.values).toContainEqual([REF]);
  });

  it('ends without a failure when the run reports the document released', async () => {
    vi.mocked(indexWholeDocument).mockResolvedValue(released);
    const log: Query[] = [];
    await expect(
      indexUploadedFile(fakeSql(log, { corpus: true }), 'file-1'),
    ).resolves.toBe(undefined);

    // The progress writes that preceded the run stand; nothing after it
    // says `failed` (a retry would index a dead ref) or `completed` (the
    // corpus holds nothing).
    const writes = statusWrites(log);
    expect(writes.length).toBeGreaterThan(0);
    expect(JSON.stringify(writes)).not.toContain('failed');
    expect(JSON.stringify(writes)).not.toContain('completed');
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('released while it ran'),
      { fileId: 'file-1', orgSlug: 'acme' },
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('hands the indexer the same liveness question, answered live', async () => {
    vi.mocked(indexWholeDocument).mockResolvedValue(released);
    const live = { corpus: true };
    await indexUploadedFile(fakeSql([], live), 'file-1');

    const args = vi.mocked(indexWholeDocument).mock.calls[0]?.[0];
    expect(args?.stillWanted).toBeTypeOf('function');
    await expect(args?.stillWanted?.()).resolves.toBe(true);
    // The ref dies while the run is in flight: the indexer's post-claim
    // question now reads the same verdict the gate would.
    live.corpus = false;
    await expect(args?.stillWanted?.()).resolves.toBe(false);
  });
});
