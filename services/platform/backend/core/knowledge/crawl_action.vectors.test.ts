// @vitest-environment node

import { computeContentHash } from '@tale/shared/utils/hashing';
import OpenAI from 'openai';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../lib/ctx';
import { WEBSITE_EMBEDDING_FAILED_PREFIX } from '../websites/scan_scheduling';
import { readOrgEmbeddingConfig } from './connection';
import { PageIndexer, type StoreOutcome, storePageText } from './crawl_action';
import { EmbeddingDimensionMismatch, pinDimensions } from './dimensions';
import {
  embedderForOrg,
  EmbeddingBudgetExceeded,
  EmbeddingNotConfigured,
} from './embedding';

vi.mock('./connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./connection')>()),
  readOrgEmbeddingConfig: vi.fn(),
}));
vi.mock('./embedding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./embedding')>()),
  embedderForOrg: vi.fn(),
}));
vi.mock('./dimensions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dimensions')>()),
  pinDimensions: vi.fn(),
}));
vi.mock('./index_health', () => ({ assertCorpusWritable: vi.fn() }));
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
function corpus(
  chunks: { present: boolean; current?: boolean; vectorless: boolean } | null,
): {
  sql: Sql;
  statements: string[];
} {
  const statements: string[] = [];
  const unsafe = (text: string): Promise<unknown[]> => {
    statements.push(text.replace(/\s+/g, ' ').trim());
    return Promise.resolve(
      text.includes('bool_or(embedding IS NULL)') && chunks !== null
        ? [{ current: true, ...chunks }]
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

  // The text was stored and the scan stopped before it was indexed: the
  // chunks still hold the page's earlier text, which the index kept serving
  // until the page changed again.
  it('re-indexes unchanged text whose chunks were cut from other text', async () => {
    const { sql } = corpus({
      present: true,
      current: false,
      vectorless: false,
    });
    await expect(
      storePageText(sql, 'ruler.example', unchangedPage, 'About', TEXT),
    ).resolves.toBe('changed');
  });

  // The visit is stamped once the page is indexed too, so a link cut off in
  // between leaves the page due for the scan that resumes it.
  it('stores the page without stamping it as visited', async () => {
    const { sql, statements } = corpus(null);
    await storePageText(sql, 'ruler.example', page('old'), 'About', TEXT);
    const update = statements.find((text) =>
      text.startsWith('UPDATE public_web.website_urls'),
    );
    expect(update).toContain("status = 'active'");
    expect(update).not.toContain('last_crawled_at');
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

describe('PageIndexer.indexPage — the embedding provider fails', () => {
  const identity = {
    domain: 'ruler.example',
    orgSlug: 'ruler',
    organizationId: 'org-1',
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the embedder is mocked; the ctx is never dispatched
  const ctx = {} as ActionCtx;

  /** A corpus double holding one stored page and nothing else. */
  function storedPage(): Sql {
    const unsafe = (text: string): Promise<unknown[]> =>
      Promise.resolve(
        text.includes('SELECT content, title')
          ? [{ content: TEXT.repeat(20), title: 'About' }]
          : [],
      );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    return { unsafe } as unknown as Sql;
  }

  const indexWith = (embedAll: () => Promise<number[][]>): Promise<void> => {
    vi.mocked(readOrgEmbeddingConfig).mockResolvedValue(null);
    vi.mocked(embedderForOrg).mockResolvedValue(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only what indexPage calls
      { dimensions: 8, embedAll } as unknown as Awaited<
        ReturnType<typeof embedderForOrg>
      >,
    );
    return new PageIndexer(ctx, storedPage(), identity).indexPage(
      'https://ruler.example/about',
    );
  };

  afterEach(() => {
    vi.mocked(embedderForOrg).mockReset();
    vi.mocked(pinDimensions).mockReset();
  });

  // Regression: a rejected embedding key left the provider's bare words on
  // the site ("401 User not found.") and the page could only say that the
  // last scan did not finish.
  it('ends the scan under a reason that names the embedding model', async () => {
    const refusal = OpenAI.APIError.generate(
      401,
      { error: { message: 'User not found.' } },
      undefined,
      new Headers(),
    );
    await expect(indexWith(() => Promise.reject(refusal))).rejects.toThrow(
      new RegExp(
        `^${WEBSITE_EMBEDDING_FAILED_PREFIX} \\[credential\\]: .*User not found`,
      ),
    );
  });

  it('names the model when the corpus cannot hold its vectors', async () => {
    vi.mocked(pinDimensions).mockRejectedValue(
      new EmbeddingDimensionMismatch(1536, 1024, 'organization "ruler"'),
    );
    await expect(indexWith(() => Promise.resolve([]))).rejects.toThrow(
      new RegExp(
        `^${WEBSITE_EMBEDDING_FAILED_PREFIX} \\[dimension\\]: .*1024-dimensional`,
      ),
    );
  });

  // The refusal an admin has to lift, met before the first page is read:
  // the reason carries its sentence, not the payload `AppError` serializes.
  it('names the model when its credential cannot be resolved', async () => {
    vi.mocked(readOrgEmbeddingConfig).mockResolvedValue(null);
    vi.mocked(embedderForOrg).mockRejectedValue(
      Object.assign(new Error('{"code":"CREDENTIAL_DISABLED"}'), {
        data: {
          code: 'CREDENTIAL_DISABLED',
          message: 'The credential "OpenRouter" is disabled.',
        },
      }),
    );
    const indexer = new PageIndexer(ctx, storedPage(), identity);
    await expect(
      indexer.settle('https://ruler.example/about', 'vectorless'),
    ).rejects.toThrow(
      `${WEBSITE_EMBEDDING_FAILED_PREFIX} [unresolved]: The credential "OpenRouter" is disabled.`,
    );
  });

  // The provider's per-minute limit, outlasting every retry: its own class,
  // so the site says the next scan continues instead of blaming the account.
  it('names the model and the rate limit when the provider throttled the pages', async () => {
    const limited = OpenAI.APIError.generate(
      429,
      {
        error: {
          code: 'insufficient_quota',
          message:
            'Allocated quota exceeded, please increase your quota limit.',
        },
      },
      undefined,
      new Headers(),
    );
    await expect(indexWith(() => Promise.reject(limited))).rejects.toThrow(
      new RegExp(
        `^${WEBSITE_EMBEDDING_FAILED_PREFIX} \\[throttled\\]: .*Allocated quota exceeded`,
      ),
    );
  });

  it('leaves an unrelated failure as it is', async () => {
    const unrelated = new Error('relation "chunks" does not exist');
    await expect(indexWith(() => Promise.reject(unrelated))).rejects.toBe(
      unrelated,
    );
  });
});

/**
 * A scan that was running when an admin saved an embedding model kept the
 * pages it had already stored without vectors — each was done for that
 * scan — until the site's next interval, up to thirty days. The link now
 * embeds them from their stored text before the scan ends.
 */
describe('PageIndexer.embedVectorless', () => {
  const identity = {
    domain: 'ruler.example',
    orgSlug: 'ruler',
    organizationId: 'org-1',
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the embedder is mocked; the ctx is never dispatched
  const ctx = {} as ActionCtx;
  let indexPage: ReturnType<typeof vi.spyOn>;

  /** A corpus double whose pages without vectors are `vectorless`; an
   * indexed page leaves the set. */
  function withVectorless(vectorless: string[]): Sql {
    const left = new Set(vectorless);
    indexPage.mockImplementation(async (url: string) => {
      left.delete(url);
    });
    const unsafe = (text: string, params: unknown[] = []) => {
      if (text.includes('count(DISTINCT c.url)')) {
        return Promise.resolve([{ n: String(left.size) }]);
      }
      if (text.includes('c.embedding IS NULL')) {
        const limit = Number(params[1] ?? left.size);
        return Promise.resolve(
          [...left].slice(0, limit).map((url) => ({ url })),
        );
      }
      return Promise.resolve([]);
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    return { unsafe } as unknown as Sql;
  }

  const model = () =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only `dimensions` is read before indexPage
    ({ dimensions: 8 }) as Awaited<ReturnType<typeof embedderForOrg>>;

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

  it('asks for no model when every page has its vectors', async () => {
    const indexer = new PageIndexer(ctx, withVectorless([]), identity);

    await expect(indexer.embedVectorless(Date.now() + 60_000)).resolves.toBe(0);

    expect(embedderForOrg).not.toHaveBeenCalled();
  });

  it('leaves them, and counts none left, while there is no model', async () => {
    vi.mocked(embedderForOrg).mockRejectedValue(
      new EmbeddingNotConfigured('ruler'),
    );
    const indexer = new PageIndexer(ctx, withVectorless(['a', 'b']), identity);

    await expect(indexer.embedVectorless(Date.now() + 60_000)).resolves.toBe(0);

    expect(indexPage).not.toHaveBeenCalled();
  });

  it('embeds each of them once a model is saved, although the link found none before', async () => {
    const indexer = new PageIndexer(
      ctx,
      withVectorless(['https://ruler.example/a', 'https://ruler.example/b']),
      identity,
    );
    // The link's first pages met no model and were stored without vectors.
    vi.mocked(embedderForOrg).mockRejectedValueOnce(
      new EmbeddingNotConfigured('ruler'),
    );
    await indexer.settle('https://ruler.example/a', 'vectorless');
    expect(indexPage).not.toHaveBeenCalled();

    // An admin saves a model while the scan runs.
    vi.mocked(embedderForOrg).mockResolvedValue(model());
    await expect(indexer.embedVectorless(Date.now() + 60_000)).resolves.toBe(0);

    expect(indexPage.mock.calls.map(([url]: unknown[]) => url)).toEqual([
      'https://ruler.example/a',
      'https://ruler.example/b',
    ]);
    // Once per link, however often the indexer met no model.
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('hands what the link had no time for to a later link', async () => {
    vi.mocked(embedderForOrg).mockResolvedValue(model());
    const indexer = new PageIndexer(ctx, withVectorless(['a', 'b']), identity);

    await expect(indexer.embedVectorless(Date.now() - 1)).resolves.toBe(2);

    expect(indexPage).not.toHaveBeenCalled();
  });
});

/**
 * A usage limit that binds whoever a scan is for stops its embedding, not
 * the scan: the page is stored without vectors — the site's own content
 * search still reads it — the rest of the link embeds nothing, and the
 * website row says why, so the hourly pass can resume the scan once the
 * limit allows it.
 */
describe('PageIndexer at a usage limit', () => {
  const identity = {
    domain: 'ruler.example',
    orgSlug: 'ruler',
    organizationId: 'org-1',
    requestedBy: { userId: 'user-1', apiKeyId: 'key-1' },
  };

  function storedPageCorpus(): { sql: Sql; inserts: unknown[][] } {
    const inserts: unknown[][] = [];
    const unsafe = (text: string, params: unknown[] = []) => {
      if (text.includes('SELECT content, title')) {
        return Promise.resolve([{ content: TEXT.repeat(20), title: 'About' }]);
      }
      if (text.includes('INSERT INTO public_web.chunks')) inserts.push(params);
      return Promise.resolve([]);
    };
    const sql = {
      unsafe,
      begin: async (run: (tx: { unsafe: typeof unsafe }) => Promise<void>) =>
        run({ unsafe }),
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    return { sql: sql as unknown as Sql, inserts };
  }

  afterEach(() => {
    vi.mocked(embedderForOrg).mockReset();
    vi.restoreAllMocks();
  });

  it('stores the page without vectors, embeds nothing more, and notes the limit on the row [GOV-R4] [WEB-R11]', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(readOrgEmbeddingConfig).mockResolvedValue(null);
    const embedAll = vi.fn(() =>
      Promise.reject(new EmbeddingBudgetExceeded('Usage limit reached.')),
    );
    vi.mocked(embedderForOrg).mockResolvedValue(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only what indexPage calls
      { dimensions: 8, embedAll } as unknown as Awaited<
        ReturnType<typeof embedderForOrg>
      >,
    );
    const runMutation = vi.fn(async () => null);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only runMutation is dispatched
    const ctx = { runMutation } as unknown as ActionCtx;
    const meter = { open: vi.fn(), settle: vi.fn(), release: vi.fn() };
    const { sql, inserts } = storedPageCorpus();
    const indexer = new PageIndexer(ctx, sql, identity, meter);

    await indexer.indexPage('https://ruler.example/about');
    await indexer.indexPage('https://ruler.example/team');
    await expect(indexer.embedVectorless(Date.now() + 60_000)).resolves.toBe(0);
    await indexer.finish();

    expect(embedderForOrg).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ meter }),
    );
    // Asked once; the second page went straight to text without vectors.
    expect(embedAll).toHaveBeenCalledTimes(1);
    expect(inserts.length).toBeGreaterThan(0);
    // The vector column (the 7th parameter) stays empty.
    expect(inserts.every((params) => params[6] === null)).toBe(true);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      domain: 'ruler.example',
      reason: 'Usage limit reached.',
      requestedBy: { userId: 'user-1', apiKeyId: 'key-1' },
    });
  });

  it('clears the note once a link embedded again', async () => {
    vi.mocked(readOrgEmbeddingConfig).mockResolvedValue(null);
    vi.mocked(embedderForOrg).mockResolvedValue(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only what indexPage calls
      {
        dimensions: 8,
        embedAll: vi.fn(async (texts: string[]) => texts.map(() => [0])),
      } as unknown as Awaited<ReturnType<typeof embedderForOrg>>,
    );
    const runMutation = vi.fn(async () => null);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only runMutation is dispatched
    const ctx = { runMutation } as unknown as ActionCtx;
    const indexer = new PageIndexer(ctx, storedPageCorpus().sql, identity);

    await indexer.indexPage('https://ruler.example/about');
    await indexer.finish();

    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      domain: 'ruler.example',
    });
  });
});
