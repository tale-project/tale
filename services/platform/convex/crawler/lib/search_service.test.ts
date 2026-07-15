import { beforeEach, describe, expect, it, vi } from 'vitest';

// The org's pool is a hoisted fake so the (hoisted) vi.mock factory can hand it
// back from getKnowledgePoolForOrg while the test still inspects it.
const hoisted = vi.hoisted(() => ({
  orgSql: { unsafe: vi.fn().mockResolvedValue([]) },
}));

// Route-to-org-pool guard: searchWeb must resolve the caller org's pool via
// getKnowledgePoolForOrg and run every query on it — calling the shared default
// getKnowledgePool would be a cross-org leak, so it throws here.
vi.mock('../../lib/knowledge/db/knowledge_db', () => ({
  getKnowledgePoolForOrg: vi.fn().mockResolvedValue(hoisted.orgSql),
  getKnowledgePool: vi.fn(() => {
    throw new Error('default pool must never serve tenant crawler data');
  }),
  PUBLIC_WEB_SCHEMA: 'public_web',
}));

vi.mock('../../lib/knowledge/config/base', () => ({
  getEmbeddingConfig: vi.fn(() => ({
    apiKey: 'k',
    baseUrl: 'https://embed.example',
    modelId: 'model',
    dimensions: 3,
  })),
}));

vi.mock('../../lib/knowledge/embedding/service', () => ({
  // A class, so `new EmbeddingService(...)` constructs (a vi.fn arrow cannot).
  EmbeddingService: class {
    embedQuery = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
  },
}));

import {
  getKnowledgePool,
  getKnowledgePoolForOrg,
} from '../../lib/knowledge/db/knowledge_db';
import { searchWeb } from './search_service';

beforeEach(() => {
  vi.mocked(getKnowledgePoolForOrg).mockClear();
  vi.mocked(getKnowledgePool).mockClear();
  hoisted.orgSql.unsafe.mockClear();
});

describe('searchWeb tenant-pool routing', () => {
  it('resolves the caller org pool and never the shared default', async () => {
    const results = await searchWeb('acme', 'hello world');

    expect(getKnowledgePoolForOrg).toHaveBeenCalledWith('acme');
    expect(getKnowledgePool).not.toHaveBeenCalled();
    // Both the FTS and the vector search ran on the org's own pool.
    expect(hoisted.orgSql.unsafe.mock.calls.length).toBeGreaterThanOrEqual(2);
    const ranOnPublicWeb = hoisted.orgSql.unsafe.mock.calls.every((call) =>
      String(call[0] as unknown).includes('public_web.chunks'),
    );
    expect(ranOnPublicWeb).toBe(true);
    expect(results).toEqual([]);
  });
});
