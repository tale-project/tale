// @vitest-environment node

/**
 * Indexing a file is the spend of whoever the file is for: its uploader,
 * else the creator of the document holding it, in that document's project
 * (or the project of the chat it was added to). A usage limit that binds
 * them parks the file — `failed` with `usage_limit`, which the hourly pass
 * resumes — before a byte is read, or as soon as a request is refused
 * mid-way; it never fails the job into its retries.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  embedderForOrg,
  EmbeddingBudgetExceeded,
} from '../../core/knowledge/embedding.ts';
import { indexWholeDocument } from '../../core/knowledge/indexing.ts';
import { RAG_ERROR_USAGE_LIMIT } from '../../core/knowledge/rag_error_codes.ts';
import { s3GetObjectBytes } from '../../core/lib/storage/object_store.ts';
import { directCallBlocked } from '../governance/direct-calls.ts';
import { indexUploadedFile } from './service.ts';

vi.mock('../../core/knowledge/indexing.ts', () => ({
  indexWholeDocument: vi.fn(),
  markCorpusIndexingFailed: vi.fn(async () => undefined),
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
vi.mock('../governance/direct-calls.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../governance/direct-calls.ts')>()),
  directCallBlocked: vi.fn(async () => null),
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
          documentId: 'doc-1',
          skipRagIndexing: null,
          uploadedBy: null,
          threadId: null,
        },
      ]);
    }
    if (text.includes('AS "createdBy"')) {
      return Promise.resolve([{ createdBy: 'drive-owner', projectId: 'p-1' }]);
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

/** The last `rag_status` write's bound values. */
const lastStatusWrite = (log: Query[]): unknown[] =>
  log.findLast((q) => q.text.includes('UPDATE app.file_metadata'))?.values ??
  [];

const CAP = {
  scope: 'project' as const,
  projectId: 'p-1',
  code: 'COST_LIMIT' as const,
  period: 'monthly' as const,
  used: 100,
  limit: 100,
  reason: 'x',
  resetsAt: Date.UTC(2026, 10, 1),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('indexUploadedFile at a usage limit', () => {
  it('books a synced file to its document’s creator and project [GOV-R14]', async () => {
    vi.mocked(indexWholeDocument).mockResolvedValue({ chunks: 1 } as never);
    const log: Query[] = [];
    await indexUploadedFile(fakeSql(log), 'file-1');

    expect(directCallBlocked).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      subject: {
        userId: 'drive-owner',
        agentSlug: '__embedding__',
        projectIds: ['p-1'],
      },
    });
    expect(embedderForOrg).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ meter: expect.any(Object) }),
    );
  });

  it('parks the file before a byte is read when a limit binds its indexing [GOV-R4] [KNOW-R17]', async () => {
    vi.mocked(directCallBlocked).mockResolvedValueOnce(CAP);
    const log: Query[] = [];
    await indexUploadedFile(fakeSql(log), 'file-1');

    expect(s3GetObjectBytes).not.toHaveBeenCalled();
    expect(embedderForOrg).not.toHaveBeenCalled();
    const write = lastStatusWrite(log);
    expect(write).toContain('failed');
    expect(write).toContain(RAG_ERROR_USAGE_LIMIT);
    expect(
      write.some(
        (value) =>
          typeof value === 'string' &&
          value.endsWith(
            'Indexing resumes by itself once the limit allows it.',
          ),
      ),
    ).toBe(true);
  });

  it('parks the file when a request is refused mid-way, without failing the job', async () => {
    vi.mocked(indexWholeDocument).mockRejectedValueOnce(
      new EmbeddingBudgetExceeded('Usage limit reached.', CAP.resetsAt, CAP),
    );
    const log: Query[] = [];
    await expect(
      indexUploadedFile(fakeSql(log), 'file-1'),
    ).resolves.toBeUndefined();

    const write = lastStatusWrite(log);
    expect(write).toContain('failed');
    expect(write).toContain(RAG_ERROR_USAGE_LIMIT);
  });
});
