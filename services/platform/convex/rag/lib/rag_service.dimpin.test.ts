import { beforeEach, describe, expect, it, vi } from 'vitest';

// The only external effect of dimension pinning is the ALTER/HNSW DDL in
// `pinEmbeddingDimensions`; stub it so the test isolates the PER-URL keying.
vi.mock('../../lib/knowledge/db/pin_embedding_dimensions', () => ({
  pinEmbeddingDimensions: vi.fn().mockResolvedValue(undefined),
}));

import type { Sql } from 'postgres';

import { pinEmbeddingDimensions } from '../../lib/knowledge/db/pin_embedding_dimensions';
import { RagService } from './rag_service';

/** Reach the private per-URL dim-pin method. */
interface Pinnable {
  pinDimsForUrl(
    dbUrl: string,
    sql: Sql,
    dims: number,
    orgSlug: string,
  ): Promise<void>;
}

const fakeSql = {} as unknown as Sql;
const URL_A = 'postgresql://user:pw@a.example:5432/rag?sslmode=require';
const URL_B = 'postgresql://user:pw@b.example:5432/rag?sslmode=require';

beforeEach(() => {
  vi.mocked(pinEmbeddingDimensions).mockClear();
});

describe('per-connection embedding-dimension pinning', () => {
  it('pins once per connection string', async () => {
    const svc = new RagService() as unknown as Pinnable;
    await svc.pinDimsForUrl(URL_A, fakeSql, 768, 'org-a');
    await svc.pinDimsForUrl(URL_A, fakeSql, 768, 'org-a-again');
    expect(pinEmbeddingDimensions).toHaveBeenCalledTimes(1);
  });

  it('pins each connection string independently', async () => {
    const svc = new RagService() as unknown as Pinnable;
    await svc.pinDimsForUrl(URL_A, fakeSql, 768, 'org-a');
    await svc.pinDimsForUrl(URL_B, fakeSql, 1536, 'org-b');
    expect(pinEmbeddingDimensions).toHaveBeenCalledTimes(2);
    expect(pinEmbeddingDimensions).toHaveBeenNthCalledWith(
      1,
      fakeSql,
      'private_knowledge',
      768,
    );
    expect(pinEmbeddingDimensions).toHaveBeenNthCalledWith(
      2,
      fakeSql,
      'private_knowledge',
      1536,
    );
  });

  it('rejects a dimension mismatch on the SAME connection string', async () => {
    const svc = new RagService() as unknown as Pinnable;
    await svc.pinDimsForUrl(URL_A, fakeSql, 768, 'org-a');
    await expect(
      svc.pinDimsForUrl(URL_A, fakeSql, 1536, 'org-c'),
    ).rejects.toThrow(/do not match the pinned dimensions/);
  });

  it('allows the same dims on a DIFFERENT connection string', async () => {
    const svc = new RagService() as unknown as Pinnable;
    await svc.pinDimsForUrl(URL_A, fakeSql, 768, 'org-a');
    await expect(
      svc.pinDimsForUrl(URL_B, fakeSql, 768, 'org-b'),
    ).resolves.toBeUndefined();
  });
});
