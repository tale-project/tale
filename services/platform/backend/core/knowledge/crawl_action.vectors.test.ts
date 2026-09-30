// @vitest-environment node

import { computeContentHash } from '@tale/shared/utils/hashing';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../lib/ctx';
import { readOrgEmbeddingConfig } from './connection';
import { PageIndexer, type StoreOutcome, storePageText } from './crawl_action';
import { embedderForOrg, EmbeddingNotConfigured } from './embedding';

vi.mock('./connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./connection')>()),
  readOrgEmbeddingConfig: vi.fn(),
}));
vi.mock('./embedding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./embedding')>()),
  embedderForOrg: vi.fn(),
}));
vi.mock('./dimensions', () => ({ pinDimensions: vi.fn() }));
vi.mock('./pool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pool')>()),
  resolveOrgUrl: vi.fn(async () => 'postgresql://corpus.example/tale'),
}));

/**
 * Pages crawled while the organization had no embedding model are chunked
 * with NULL vectors. The regression: a later scan found their text
 * unchanged and their chunks present and left them alone, so configuring a
 * model never embedded them — the dense leg could not see them until the
 * site happened to change a page. Unchanged text whose chunks lack vectors
 * is now `vectorless`, and the indexer embeds it once a model can.
 */

const TEXT = 'Ruler GmbH was founded in Spiez in 2020.';

/** A corpus double: every write succeeds, the chunk probe answers `chunks`. */
function corpus(chunks: { present: boolean; vectorless: boolean } | null): {
  sql: Sql;
  statements: string[];
} {
  const statements: string[] = [];
  const unsafe = (text: string): Promise<unknown[]> => {
    statements.push(text.replace(/\s+/g, ' ').trim());
    return Promise.resolve(
      text.includes('bool_or(embedding IS NULL)') && chunks !== null
        ? [chunks]
        : [],
    );
  };
  const sql = {
    unsafe,
    begin: async (run: (tx: { unsafe: typeof unsafe }) => Promise<void>) =>
      run({ unsafe }),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, statements };
}

const page = (contentHash: string | null) => ({
  url: 'https://ruler.example/about',
  content_hash: contentHash,
  listed: false,
});

describe('storePageText', () => {
  const unchangedPage = page(computeContentHash(TEXT));

  it('reports unchanged text chunked without vectors as vectorless', async () => {
    const { sql } = corpus({ present: true, vectorless: true });
    await expect(
      storePageText(sql, 'ruler.example', unchangedPage, 'About', TEXT),
    ).resolves.toBe('vectorless');
  });

  it('leaves unchanged text with embedded chunks alone', async () => {
    const { sql } = corpus({ present: true, vectorless: false });
    await expect(
      storePageText(sql, 'ruler.example', unchangedPage, 'About', TEXT),
    ).resolves.toBe('unchanged');
  });

  it('still re-indexes unchanged text whose chunks are missing, and changed text', async () => {
    const missing = corpus({ present: false, vectorless: false });
    await expect(
      storePageText(missing.sql, 'ruler.example', unchangedPage, 'About', TEXT),
    ).resolves.toBe('changed');
    const changed = corpus(null);
    await expect(
      storePageText(changed.sql, 'ruler.example', page('old'), 'About', TEXT),
    ).resolves.toBe('changed');
    expect(changed.statements.some((text) => text.includes('bool_or'))).toBe(
      false,
    );
  });
});

describe('PageIndexer.settle', () => {
  const identity = {
    domain: 'ruler.example',
    orgSlug: 'ruler',
    organizationId: 'org-1',
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the embedder is mocked; the ctx is never dispatched
  const ctx = {} as ActionCtx;
  let indexPage: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(readOrgEmbeddingConfig).mockResolvedValue(null);
    indexPage = vi
      .spyOn(PageIndexer.prototype, 'indexPage')
      .mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(embedderForOrg).mockReset();
  });

  const settle = async (outcome: StoreOutcome): Promise<void> => {
    const indexer = new PageIndexer(ctx, corpus(null).sql, identity);
    await indexer.settle('https://ruler.example/about', outcome);
  };

  it('embeds vectorless text once a model can, and not before', async () => {
    vi.mocked(embedderForOrg).mockRejectedValue(
      new EmbeddingNotConfigured('ruler'),
    );
    await settle('vectorless');
    expect(indexPage).not.toHaveBeenCalled();

    vi.mocked(embedderForOrg).mockResolvedValue(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only `dimensions` is read before indexPage
      { dimensions: 8 } as Awaited<ReturnType<typeof embedderForOrg>>,
    );
    await settle('vectorless');
    expect(indexPage).toHaveBeenCalledTimes(1);
  });

  it('always indexes changed text and never touches unchanged text', async () => {
    vi.mocked(embedderForOrg).mockRejectedValue(
      new EmbeddingNotConfigured('ruler'),
    );
    await settle('changed');
    expect(indexPage).toHaveBeenCalledTimes(1);
    await settle('unchanged');
    expect(indexPage).toHaveBeenCalledTimes(1);
    expect(embedderForOrg).not.toHaveBeenCalled();
  });
});
