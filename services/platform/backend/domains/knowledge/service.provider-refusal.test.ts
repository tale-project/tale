// @vitest-environment node

import OpenAI from 'openai';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { indexDocument } from '../../core/knowledge/indexing.ts';
import { RAG_ERROR_EMBEDDING_PROVIDER_REFUSED } from '../../core/knowledge/rag_error_codes.ts';
import { indexUploadedFile } from './service.ts';

/**
 * `rag.index_file` retries five times with backoff. A provider that refused
 * the ACCOUNT (balance, plan, billing) or the CREDENTIAL answers every retry
 * the same way, and each retry re-sends the chunks — so the job must end at
 * the first refusal with the cause on the file, not throw into the retry
 * loop. A transient provider failure keeps throwing, which is what the
 * retries are for.
 */

vi.mock('../../core/knowledge/indexing.ts', () => ({ indexDocument: vi.fn() }));
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

const providerError = (status: number, body: Record<string, unknown>) =>
  OpenAI.APIError.generate(status, body, undefined, new Headers());

beforeEach(() => {
  vi.mocked(indexDocument).mockReset();
});

describe('indexUploadedFile — provider refusals', () => {
  it.each([
    [
      'an account refusal',
      providerError(429, {
        error: {
          code: 'insufficient_quota',
          message: 'You exceeded your current quota',
        },
      }),
    ],
    [
      'a rejected credential',
      providerError(401, {
        error: { code: 'invalid_api_key', message: 'Incorrect API key' },
      }),
    ],
  ])(
    'ends the job on %s with the cause on the file, never a retry',
    async (_label, error) => {
      vi.mocked(indexDocument).mockRejectedValue(error);
      const log: Query[] = [];

      await expect(indexUploadedFile(fakeSql(log), 'file-1')).resolves.toBe(
        undefined,
      );

      const write = lastStatusWrite(log);
      expect(write).toContain('failed');
      expect(write).toContain(RAG_ERROR_EMBEDDING_PROVIDER_REFUSED);
      expect(indexDocument).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps throwing on a transient provider failure — that is what the retries are for', async () => {
    vi.mocked(indexDocument).mockRejectedValue(
      providerError(503, { error: { message: 'The server is overloaded' } }),
    );
    const log: Query[] = [];

    await expect(
      indexUploadedFile(fakeSql(log), 'file-1'),
    ).rejects.toBeInstanceOf(OpenAI.APIError);

    const write = lastStatusWrite(log);
    expect(write).toContain('failed');
    expect(write).not.toContain(RAG_ERROR_EMBEDDING_PROVIDER_REFUSED);
  });
});
