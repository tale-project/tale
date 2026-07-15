import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The only external effect of dimension pinning is the ALTER/HNSW DDL in
// pinEmbeddingDimensions; stub it so the test isolates the per-pool keying and
// the public_web schema target.
vi.mock('../../lib/knowledge/db/pin_embedding_dimensions', () => ({
  pinEmbeddingDimensions: vi.fn().mockResolvedValue(undefined),
}));

// Embedding dims come from the org's provider config; stub it so no config files
// are read (org-b uses a different model to prove per-pool independence).
vi.mock('../../lib/knowledge/config/base', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../lib/knowledge/config/base')>();
  return {
    ...actual,
    getEmbeddingConfig: vi.fn((org: string) => ({
      apiKey: 'k',
      baseUrl: 'https://embed.example',
      modelId: 'model',
      dimensions: org === 'org-b' ? 1536 : 768,
    })),
  };
});

import { pinEmbeddingDimensions } from '../../lib/knowledge/db/pin_embedding_dimensions';
import { ensureWebEmbeddingDimensionsPinned } from './indexing_service';

const poolA = {} as Sql;
const poolB = {} as Sql;

beforeEach(() => {
  vi.mocked(pinEmbeddingDimensions).mockClear();
});

describe('public_web embedding-dimension pinning', () => {
  it('pins the public_web schema once per pool', async () => {
    await ensureWebEmbeddingDimensionsPinned('org-a', poolA);
    await ensureWebEmbeddingDimensionsPinned('org-a', poolA);
    expect(pinEmbeddingDimensions).toHaveBeenCalledTimes(1);
    expect(pinEmbeddingDimensions).toHaveBeenCalledWith(
      poolA,
      'public_web',
      768,
    );
  });

  it('pins each pool independently, with its own dimensions', async () => {
    await ensureWebEmbeddingDimensionsPinned('org-b', poolB);
    expect(pinEmbeddingDimensions).toHaveBeenCalledTimes(1);
    expect(pinEmbeddingDimensions).toHaveBeenCalledWith(
      poolB,
      'public_web',
      1536,
    );
  });
});
