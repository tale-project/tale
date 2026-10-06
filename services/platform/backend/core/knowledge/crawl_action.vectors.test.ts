// @vitest-environment node

import { computeContentHash } from '@tale/shared/utils/hashing';
import OpenAI from 'openai';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../lib/ctx';
import { WEBSITE_EMBEDDING_FAILED_PREFIX } from '../websites/scan_scheduling';
import { readOrgEmbeddingConfig } from './connection';
import { PageIndexer, type StoreOutcome, storePageText } from './crawl_action';
import { EmbeddingDimensionMismatch } from './dimensions';
import { embedderForOrg, EmbeddingNotConfigured } from './embedding';

vi.mock('./connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./connection')>()),
  readOrgEmbeddingConfig: vi.fn(),
}));
vi.mock('./embedding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./embedding')>()),
  embedderForOrg: vi.fn(),
}));
vi.mock('./index_health', () => ({ assertCorpusWritable: vi.fn() }));
vi.mock('./pool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pool')>()),
  resolveOrgUrl: vi.fn(async () => 'postgresql://corpus.example/tale'),
}));

/**
 * Pages crawled while the organization had no embedding model are chunked
 * without vectors. The regression: a later scan found their text unchanged
 * and their chunks present and left them alone, so configuring a model never
 * embedded them — the dense leg could not see them until the site happened
 * to change a page. The indexer now embeds, at the end of each link, every
 * page whose chunks have no vector of the scanning organization's width.
 *
 * Vectors are kept per width (`chunk_vectors_<width>`), and a site's chunks
 * are shared by every organization that registered its domain — so "has its
 * vectors" is asked for one width, and embedding a page for one organization
 * leaves the vectors other organizations hold for it alone.
 */

const TEXT = 'Ruler GmbH was founded in Spiez in 2020.';

const identity = {
  domain: 'ruler.example',
  orgSlug: 'ruler',
  organizationId: 'org-1',
};
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the embedder is mocked; the ctx is never dispatched
const ctx = {} as ActionCtx;

/** The organization's embedding settings, as the indexer reads them. */
const settings = (dimensions: number) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only `dimensions` is read
  ({ providerSlug: 'p', model: 'm', dimensions }) as Awaited<
    ReturnType<typeof readOrgEmbeddingConfig>
  >;

/** A resolved model: `dimensions`, and `embedAll` where a test embeds. */
const model = (
  dimensions: number,
  embedAll?: (texts: string[]) => Promise<number[][]>,
) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only what the indexer calls
  ({ dimensions, embedAll }) as unknown as Awaited<
    ReturnType<typeof embedderForOrg>
  >;

interface Statement {
  readonly text: string;
  readonly params: readonly unknown[];
}

/** A corpus double: records every statement, answers the ones `answer`
 * knows, and runs a transaction on the same recorder. */
function corpus(
  answer: (text: string, params: readonly unknown[]) => unknown[] | undefined,
): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const unsafe = (text: string, params: unknown[] = []): Promise<unknown[]> => {
    const flat = text.replace(/\s+/g, ' ').trim();
    statements.push({ text: flat, params });
    return Promise.resolve(answer(flat, params) ?? []);
  };
  const sql = {
    unsafe,
    begin: async (run: (tx: { unsafe: typeof unsafe }) => Promise<void>) =>
      run({ unsafe }),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, statements };
}

/** The chunk probe `storePageText` runs for unchanged text. */
const chunkProbe =
  (chunks: { present: boolean; current?: boolean } | null) =>
  (text: string): unknown[] | undefined =>
    text.includes('bool_and(content_hash') && chunks !== null
      ? [{ current: true, ...chunks }]
      : undefined;

const page = (contentHash: string | null) => ({
  url: 'https://ruler.example/about',
  content_hash: contentHash,
  listed: false,
});

describe('storePageText', () => {
  const unchangedPage = page(computeContentHash(TEXT));

  // Whether the chunks have their vectors depends on the width of the
  // organization scanning, so storing the text does not ask.
  it('leaves unchanged text with current chunks alone, without asking for vectors', async () => {
    const { sql, statements } = corpus(chunkProbe({ present: true }));
    await expect(
      storePageText(sql, 'ruler.example', unchangedPage, 'About', TEXT),
    ).resolves.toBe('unchanged');
    for (const { text } of statements) {
      expect(text).not.toContain('chunk_vectors_');
      expect(text).not.toContain('embedding');
    }
  });

  // The text was stored and the scan stopped before it was indexed: the
  // chunks still hold the page's earlier text, which the index kept serving
  // until the page changed again.
  it('re-indexes unchanged text whose chunks were cut from other text', async () => {
    const { sql } = corpus(chunkProbe({ present: true, current: false }));
    await expect(
      storePageText(sql, 'ruler.example', unchangedPage, 'About', TEXT),
    ).resolves.toBe('changed');
  });

  // The visit is stamped once the page is indexed too, so a link cut off in
  // between leaves the page due for the scan that resumes it.
  it('stores the page without stamping it as visited', async () => {
    const { sql, statements } = corpus(chunkProbe(null));
    await storePageText(sql, 'ruler.example', page('old'), 'About', TEXT);
    const update = statements.find(({ text }) =>
      text.startsWith('UPDATE public_web.website_urls'),
    );
    expect(update?.text).toContain("status = 'active'");
    expect(update?.text).not.toContain('last_crawled_at');
  });

  it('still re-indexes unchanged text whose chunks are missing, and changed text', async () => {
    const missing = corpus(chunkProbe({ present: false }));
    await expect(
      storePageText(missing.sql, 'ruler.example', unchangedPage, 'About', TEXT),
    ).resolves.toBe('changed');
    const changed = corpus(chunkProbe(null));
    await expect(
      storePageText(changed.sql, 'ruler.example', page('old'), 'About', TEXT),
    ).resolves.toBe('changed');
    expect(
      changed.statements.some(({ text }) => text.includes('bool_and')),
    ).toBe(false);
  });
});

describe('PageIndexer.settle', () => {
  let indexPage: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(readOrgEmbeddingConfig).mockResolvedValue(null);
    indexPage = vi
      .spyOn(PageIndexer.prototype, 'indexPage')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(embedderForOrg).mockReset();
  });

  const settle = async (outcome: StoreOutcome): Promise<void> => {
    const indexer = new PageIndexer(ctx, corpus(() => undefined).sql, identity);
    await indexer.settle('https://ruler.example/about', outcome);
  };

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

/** A corpus double holding one stored page and nothing else; a chunk it
 * stores gets its `chunk_index` as its id. */
const storedPage = () =>
  corpus((text, params) => {
    if (text.includes('SELECT content, title')) {
      return [{ content: TEXT.repeat(20), title: 'About' }];
    }
    if (text.startsWith('INSERT INTO public_web.chunks')) {
      return [{ id: `chunk-${String(params[4])}` }];
    }
    return undefined;
  });

describe('PageIndexer.indexPage — where the vectors go [KNOW-R11]', () => {
  beforeEach(() => {
    vi.mocked(readOrgEmbeddingConfig).mockResolvedValue(null);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(embedderForOrg).mockReset();
  });

  it('stores each chunk with its vector in the table of the model’s width', async () => {
    vi.mocked(embedderForOrg).mockResolvedValue(
      model(1024, async (texts) => texts.map(() => [0.25])),
    );
    const { sql, statements } = storedPage();

    await new PageIndexer(ctx, sql, identity).indexPage(
      'https://ruler.example/about',
    );

    const chunkWrites = statements.flatMap(({ text }, index) =>
      text.startsWith('INSERT INTO public_web.chunks') ? [index] : [],
    );
    expect(chunkWrites.length).toBeGreaterThan(0);
    for (const index of chunkWrites) {
      // The old column held one width for the whole database.
      expect(statements[index]?.text).not.toMatch(/chunk_content,\s*embedding/);
      // The vector follows its chunk, in the same transaction.
      expect(statements[index + 1]?.text).toContain(
        'INSERT INTO public_web.chunk_vectors_1024 (chunk_id, embedding)',
      );
      expect(statements[index + 1]?.params).toEqual([
        `chunk-${String(statements[index]?.params[4])}`,
        JSON.stringify([0.25]),
      ]);
    }
  });

  it('stores the chunks without vectors while there is no model', async () => {
    vi.mocked(embedderForOrg).mockRejectedValue(
      new EmbeddingNotConfigured('ruler'),
    );
    const { sql, statements } = storedPage();

    await new PageIndexer(ctx, sql, identity).indexPage(
      'https://ruler.example/about',
    );

    expect(
      statements.some(({ text }) =>
        text.startsWith('INSERT INTO public_web.chunks'),
      ),
    ).toBe(true);
    for (const { text } of statements) {
      expect(text).not.toContain('chunk_vectors_');
    }
  });
});

describe('PageIndexer.indexPage — the embedding provider fails', () => {
  const indexWith = (
    embedAll: () => Promise<number[][]>,
    dimensions = 1024,
  ): Promise<void> => {
    vi.mocked(readOrgEmbeddingConfig).mockResolvedValue(null);
    vi.mocked(embedderForOrg).mockResolvedValue(model(dimensions, embedAll));
    return new PageIndexer(ctx, storedPage().sql, identity).indexPage(
      'https://ruler.example/about',
    );
  };

  afterEach(() => {
    vi.mocked(embedderForOrg).mockReset();
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

  it('names the model when it answers vectors of another width than stated', async () => {
    const mismatch = new EmbeddingDimensionMismatch(
      1536,
      1024,
      'the embedding model "flash"',
    );
    await expect(indexWith(() => Promise.reject(mismatch))).rejects.toThrow(
      new RegExp(
        `^${WEBSITE_EMBEDDING_FAILED_PREFIX} \\[dimension\\]: .*1024-dimensional`,
      ),
    );
  });

  // A settings file written before the widths were a list: refused before a
  // page is embedded, under the same class.
  it('names the model when its width has no table [KNOW-R11]', async () => {
    const embedAll = vi.fn(async () => []);
    await expect(indexWith(embedAll, 1000)).rejects.toThrow(
      new RegExp(
        `^${WEBSITE_EMBEDDING_FAILED_PREFIX} \\[dimension\\]: .*vector width of 1000`,
      ),
    );
    expect(embedAll).not.toHaveBeenCalled();
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
    const indexer = new PageIndexer(ctx, storedPage().sql, identity);
    await expect(
      indexer.indexPage('https://ruler.example/about'),
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
  let embedPage: ReturnType<typeof vi.spyOn>;

  /** A corpus double whose pages without vectors are `vectorless`; an
   * embedded page leaves the set. It also holds one stored page, for the
   * link that indexes a changed page before the sweep. */
  function withVectorless(vectorless: string[]): {
    sql: Sql;
    statements: Statement[];
  } {
    const left = new Set(vectorless);
    embedPage.mockImplementation(async (url: string) => {
      left.delete(url);
    });
    return corpus((text, params) => {
      if (text.includes('SELECT content, title')) {
        return [{ content: TEXT.repeat(20), title: 'About' }];
      }
      if (text.includes('count(DISTINCT c.url)')) {
        return [{ n: String(left.size) }];
      }
      if (text.includes('SELECT DISTINCT c.url')) {
        const limit = Number(params[1] ?? left.size);
        return [...left].slice(0, limit).map((url) => ({ url }));
      }
      return undefined;
    });
  }

  beforeEach(() => {
    vi.mocked(readOrgEmbeddingConfig).mockResolvedValue(settings(1024));
    embedPage = vi
      .spyOn(PageIndexer.prototype, 'embedPage')
      .mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(embedderForOrg).mockReset();
  });

  it('asks for no model when every page has its vectors', async () => {
    const indexer = new PageIndexer(ctx, withVectorless([]).sql, identity);

    await expect(indexer.embedVectorless(Date.now() + 60_000)).resolves.toBe(0);

    expect(embedderForOrg).not.toHaveBeenCalled();
  });

  it('leaves them, and counts none left, while there is no model', async () => {
    vi.mocked(readOrgEmbeddingConfig).mockResolvedValue(null);
    const { sql, statements } = withVectorless(['a', 'b']);
    const indexer = new PageIndexer(ctx, sql, identity);

    await expect(indexer.embedVectorless(Date.now() + 60_000)).resolves.toBe(0);

    expect(embedPage).not.toHaveBeenCalled();
    expect(embedderForOrg).not.toHaveBeenCalled();
    // Without a stated width there is no table to ask.
    expect(statements).toEqual([]);
  });

  // "Without vectors" is asked for the width the organization's settings
  // state: pages another organization's scan embedded at another width are
  // this organization's to embed.
  it.each([1024, 1536])(
    'looks for the pages without a vector of the stated width (%s)',
    async (dimensions) => {
      vi.mocked(readOrgEmbeddingConfig).mockResolvedValue(settings(dimensions));
      vi.mocked(embedderForOrg).mockResolvedValue(model(dimensions));
      const { sql, statements } = withVectorless(['https://ruler.example/a']);
      const indexer = new PageIndexer(ctx, sql, identity);

      await expect(indexer.embedVectorless(Date.now() + 60_000)).resolves.toBe(
        0,
      );

      const table = `public_web.chunk_vectors_${dimensions}`;
      for (const { text } of statements) {
        expect(text).toContain(
          `NOT EXISTS (SELECT 1 FROM ${table} v WHERE v.chunk_id = c.id)`,
        );
      }
      expect(embedPage).toHaveBeenCalledWith('https://ruler.example/a', table);
    },
  );

  it('ends the scan when the stated width has no table [KNOW-R11]', async () => {
    vi.mocked(readOrgEmbeddingConfig).mockResolvedValue(settings(1000));
    const indexer = new PageIndexer(ctx, withVectorless(['a']).sql, identity);

    await expect(indexer.embedVectorless(Date.now() + 60_000)).rejects.toThrow(
      new RegExp(
        `^${WEBSITE_EMBEDDING_FAILED_PREFIX} \\[dimension\\]: .*vector width of 1000`,
      ),
    );
    expect(embedderForOrg).not.toHaveBeenCalled();
  });

  it('embeds each of them once a model is saved, although the link found none before', async () => {
    const indexer = new PageIndexer(
      ctx,
      withVectorless(['https://ruler.example/a', 'https://ruler.example/b'])
        .sql,
      identity,
    );
    // The link's first pages met no model and were stored without vectors.
    vi.mocked(readOrgEmbeddingConfig).mockResolvedValue(null);
    vi.mocked(embedderForOrg).mockRejectedValueOnce(
      new EmbeddingNotConfigured('ruler'),
    );
    await indexer.settle('https://ruler.example/a', 'changed');
    await indexer.settle('https://ruler.example/b', 'changed');
    expect(embedPage).not.toHaveBeenCalled();

    // An admin saves a model while the scan runs.
    vi.mocked(readOrgEmbeddingConfig).mockResolvedValue(settings(1024));
    vi.mocked(embedderForOrg).mockResolvedValue(model(1024));
    await expect(indexer.embedVectorless(Date.now() + 60_000)).resolves.toBe(0);

    expect(embedPage.mock.calls.map(([url]: unknown[]) => url)).toEqual([
      'https://ruler.example/a',
      'https://ruler.example/b',
    ]);
    // Once per link, however often the indexer met no model.
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('hands what the link had no time for to a later link', async () => {
    vi.mocked(embedderForOrg).mockResolvedValue(model(1024));
    const indexer = new PageIndexer(
      ctx,
      withVectorless(['a', 'b']).sql,
      identity,
    );

    await expect(indexer.embedVectorless(Date.now() - 1)).resolves.toBe(2);

    expect(embedPage).not.toHaveBeenCalled();
  });
});

/**
 * Two organizations registered one site, with embedding models of different
 * widths. Embedding the site for one of them must not take the other's
 * vectors away: the chunks stay, and only the missing width is added.
 */
describe('PageIndexer.embedPage [KNOW-R11]', () => {
  const VECTORS = 'public_web.chunk_vectors_1024';
  const URL = 'https://ruler.example/about';

  /** A page whose listed chunks lack a vector of this width. */
  const pageLacking = (chunks: { id: string; chunk_content: string }[]) =>
    corpus((text) =>
      text.startsWith('SELECT c.id::text AS id, c.chunk_content')
        ? chunks
        : undefined,
    );

  beforeEach(() => {
    vi.mocked(readOrgEmbeddingConfig).mockResolvedValue(settings(1024));
  });

  afterEach(() => {
    vi.mocked(embedderForOrg).mockReset();
  });

  it('adds this width’s vectors to the stored chunks and leaves the chunks alone', async () => {
    const embedAll = vi.fn(async (texts: string[]) =>
      texts.map((_text, index) => [index]),
    );
    vi.mocked(embedderForOrg).mockResolvedValue(model(1024, embedAll));
    const { sql, statements } = pageLacking([
      { id: '11', chunk_content: 'first stored chunk' },
      { id: '12', chunk_content: 'second stored chunk' },
    ]);

    await new PageIndexer(ctx, sql, identity).embedPage(URL, VECTORS);

    // The stored text is what is embedded — no re-chunking.
    expect(embedAll).toHaveBeenCalledWith([
      'first stored chunk',
      'second stored chunk',
    ]);
    const inserts = statements.filter(({ text }) => text.startsWith('INSERT'));
    expect(inserts.map(({ params }) => params)).toEqual([
      ['11', JSON.stringify([0])],
      ['12', JSON.stringify([1])],
    ]);
    for (const { text } of inserts) {
      expect(text).toContain(`INSERT INTO ${VECTORS} (chunk_id, embedding)`);
    }
    // Deleting a chunk would delete its vectors of every width — the other
    // organizations' included.
    for (const { text } of statements) {
      expect(text).not.toContain('DELETE');
      expect(text).not.toContain('INSERT INTO public_web.chunks');
    }
  });

  it('asks only for the chunks that lack a vector of this width', async () => {
    vi.mocked(embedderForOrg).mockResolvedValue(model(1024));
    const { sql, statements } = pageLacking([]);

    await new PageIndexer(ctx, sql, identity).embedPage(URL, VECTORS);

    expect(statements.length).toBe(1);
    expect(statements[0]?.text).toContain(
      `NOT EXISTS (SELECT 1 FROM ${VECTORS} v WHERE v.chunk_id = c.id)`,
    );
    expect(statements[0]?.params).toEqual(['ruler.example', URL]);
    // Nothing to embed: the model is not resolved.
    expect(embedderForOrg).not.toHaveBeenCalled();
  });
});
