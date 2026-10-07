// @vitest-environment node

/**
 * Whether the assistant can search what the crawl stores. The failure this
 * names: a site read Active with every page indexed while chat answered
 * that web-page search "is not set up" — every search embeds its query
 * first, and the organization had no embedding model. The Websites page
 * reads this to say so.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(async () => 'acme'),
}));
vi.mock('../knowledge/admin.ts', () => ({
  readKnowledgeEmbeddingView: vi.fn(),
}));
vi.mock('../provider_credentials/service.ts', () => ({
  isCredentialSelectionResolvable: vi.fn(),
}));

import { resolveOrgSlug } from '../../lib/org-config.ts';
import { readKnowledgeEmbeddingView } from '../knowledge/admin.ts';
import { isCredentialSelectionResolvable } from '../provider_credentials/service.ts';
import { websiteSearchReady } from './search-readiness.ts';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- never queried: every read is mocked
const sql = {} as Sql;

type EmbeddingView = Awaited<ReturnType<typeof readKnowledgeEmbeddingView>>;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the fields the read inspects
const view = (fields: object) => fields as EmbeddingView;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveOrgSlug).mockResolvedValue('acme');
});

describe('websiteSearchReady [WEB-R10]', () => {
  it('is false while the organization has no embedding model', async () => {
    vi.mocked(readKnowledgeEmbeddingView).mockResolvedValue(
      view({ configured: false }),
    );
    await expect(websiteSearchReady(sql, 'org-1')).resolves.toBe(false);
    expect(isCredentialSelectionResolvable).not.toHaveBeenCalled();
  });

  it('is true once a model is configured and its credential resolves', async () => {
    vi.mocked(readKnowledgeEmbeddingView).mockResolvedValue(
      view({
        configured: true,
        providerSlug: 'openrouter',
        credentialId: 'c-1',
      }),
    );
    vi.mocked(isCredentialSelectionResolvable).mockResolvedValue(true);

    await expect(websiteSearchReady(sql, 'org-1')).resolves.toBe(true);
    expect(isCredentialSelectionResolvable).toHaveBeenCalledWith(sql, 'org-1', {
      providerSlug: 'openrouter',
      credentialId: 'c-1',
    });
  });

  it('is false when the configured model has no credential left to call it with', async () => {
    vi.mocked(readKnowledgeEmbeddingView).mockResolvedValue(
      view({ configured: true, providerSlug: 'openrouter' }),
    );
    vi.mocked(isCredentialSelectionResolvable).mockResolvedValue(false);
    await expect(websiteSearchReady(sql, 'org-1')).resolves.toBe(false);
  });

  it('is false for an organization without a slug', async () => {
    vi.mocked(resolveOrgSlug).mockResolvedValue(null);
    await expect(websiteSearchReady(sql, 'org-1')).resolves.toBe(false);
    expect(readKnowledgeEmbeddingView).not.toHaveBeenCalled();
  });
});
