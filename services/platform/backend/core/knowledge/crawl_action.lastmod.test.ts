// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { safeFetch } from '../../../lib/net/safe-fetch';
import type { ActionCtx } from '../lib/ctx';
import { scanWebsiteImpl } from './crawl_action';
import { getKnowledgePoolForOrg } from './pool';

vi.mock('./pool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pool')>()),
  getKnowledgePoolForOrg: vi.fn(),
}));
vi.mock('../../../lib/net/safe-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/net/safe-fetch')>()),
  safeFetch: vi.fn(),
}));

/**
 * A rescan leaves alone the pages a site's sitemap says have not changed.
 * The regression: the crawler read `<loc>` out of a sitemap and nothing
 * else, so every scan requested every page again — probe, browser render
 * and all the assets a render loads — and compared content hashes
 * afterwards. A site that dated all 700 of its pages answered some 8,000
 * requests a scan, every six hours, for pages unchanged in months.
 *
 * Pinned on a recording double (which statements run, with which
 * parameters); what the frontier predicate selects on real rows rides the
 * integration check.
 */

const SCAN = {
  domain: 'docs.example',
  orgSlug: 'acme',
  organizationId: 'org-1',
};

/** Twelve pages, over the link-walk threshold, so discovery is the sitemap
 * alone. The first two carry a date, the homepage twice. */
const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://docs.example</loc><lastmod>2026-07-27</lastmod></url>
  <url><loc>https://docs.example/guide</loc><lastmod>2026-10-06T08:00:00+02:00</lastmod></url>
  <url><loc>https://docs.example/</loc><lastmod>2026-08-01</lastmod></url>
  <url><loc>https://docs.example/undated</loc></url>
  <url><loc>https://docs.example/unreadable</loc><lastmod>last week</lastmod></url>
  ${Array.from(
    { length: 8 },
    (_, index) => `<url><loc>https://docs.example/more/${index}</loc></url>`,
  ).join('\n  ')}
</urlset>`;

interface Statement {
  text: string;
  params: unknown[];
  inTx: boolean;
}

/** A corpus double that grants the claim and answers the frontier as
 * empty: the link discovers, records and finishes. */
function corpus(): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const unsafeFor =
    (inTx: boolean) =>
    (text: string, params: unknown[] = []): Promise<unknown[]> => {
      const statement = text.replace(/\s+/g, ' ').trim();
      statements.push({ text: statement, params, inTx });
      if (statement.startsWith('SELECT kind')) {
        return Promise.resolve([{ kind: 'site', robots_disallow: null }]);
      }
      if (statement.includes("SET status = 'scanning'")) {
        return Promise.resolve([{ domain: SCAN.domain }]);
      }
      if (statement.includes('AND COALESCE(')) {
        return Promise.resolve([{ n: '2' }]);
      }
      if (statement.includes('FILTER (WHERE u.status')) {
        return Promise.resolve([
          { stored: '12', attempted: '12', failed: '0', skipped: '0' },
        ]);
      }
      return Promise.resolve([]);
    };
  const sql = {
    unsafe: unsafeFor(false),
    begin: async (
      run: (tx: { unsafe: ReturnType<typeof unsafeFor> }) => Promise<void>,
    ) => run({ unsafe: unsafeFor(true) }),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, statements };
}

function engineCtx(): ActionCtx {
  const ctx = {
    runMutation: vi.fn(async () => ({ paused: false })),
    runQuery: vi.fn(),
    scheduler: { runAfter: vi.fn() },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only what the link reaches
  return ctx as unknown as ActionCtx;
}

const forgotten = (statements: Statement[]) =>
  statements.filter((statement) =>
    statement.text.includes('SET sitemap_lastmod = NULL'),
  );
const written = (statements: Statement[]) =>
  statements.filter((statement) => statement.text.includes('FROM unnest('));
const frontier = (statements: Statement[]) =>
  statements.filter(
    (statement) =>
      statement.text.startsWith('SELECT url, content_hash, listed') ||
      (statement.text.startsWith('SELECT count(*)::text AS n') &&
        statement.text.includes('AND NOT COALESCE(')),
  );

const logged = (): string =>
  vi
    .mocked(console.log)
    .mock.calls.map((call) => String(call[0]))
    .join('\n');

beforeEach(() => {
  vi.mocked(getKnowledgePoolForOrg).mockReset();
  vi.mocked(safeFetch).mockReset();
  vi.mocked(safeFetch).mockImplementation(async (url) => {
    const answer = (body: string) => ({
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      body,
      finalUrl: url,
    });
    if (url.endsWith('/robots.txt')) {
      return answer(
        `User-agent: *\nSitemap: https://${SCAN.domain}/sitemap.xml\n`,
      );
    }
    if (url.endsWith('/sitemap.xml')) return answer(SITEMAP);
    return { ...answer('gone'), status: 404, statusText: 'Not Found' };
  });
  // Cleared: a spy on a method that is already spied on keeps its calls.
  vi.spyOn(console, 'log')
    .mockClear()
    .mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe("scanWebsiteImpl — what a site's sitemap says about its pages", () => {
  it('records the date of every page whose entry states one, and forgets the rest', async () => {
    const { sql, statements } = corpus();
    vi.mocked(getKnowledgePoolForOrg).mockResolvedValue(sql);

    await scanWebsiteImpl(engineCtx(), SCAN);

    // The homepage is named twice: the later date stands. A date alone
    // covers its whole day in any time zone.
    const dated = [
      ['https://docs.example/', '2026-08-02T12:00:00.000Z'],
      ['https://docs.example/guide', '2026-10-06T06:00:00.000Z'],
    ];
    expect(written(statements).map((statement) => statement.params)).toEqual([
      [
        SCAN.domain,
        dated.map(([url]) => url),
        dated.map(([, lastmod]) => lastmod),
      ],
    ]);
    // An entry without a date, or with one that cannot be read, leaves its
    // page without one: such a page is requested.
    expect(forgotten(statements).map((statement) => statement.params)).toEqual([
      [SCAN.domain, dated.map(([url]) => url)],
    ]);
    expect(
      [...forgotten(statements), ...written(statements)].every(
        (statement) => statement.inTx,
      ),
    ).toBe(true);
    // After the admission: a page found by this scan has its row by then.
    const texts = statements.map((statement) => statement.text);
    expect(
      texts.findIndex((text) => text.includes('RETURNING u.url')),
    ).toBeLessThan(texts.findIndex((text) => text.includes('FROM unnest(')));
    expect(logged()).toContain(
      '12 URLs discovered, 2 not requested (unchanged by their sitemap dates)',
    );
  });

  it('leaves a page alone only while its stored text was read after the date, within the week [KNOW-R16]', async () => {
    const { sql, statements } = corpus();
    vi.mocked(getKnowledgePoolForOrg).mockResolvedValue(sql);

    await scanWebsiteImpl(engineCtx(), SCAN);

    // Both readers of the frontier: the pages a link takes next, and how
    // many are left for the next link.
    const readers = frontier(statements);
    expect(readers).toHaveLength(2);
    for (const reader of readers) {
      // Without a date, or never read, the clause is NULL and the page due.
      expect(reader.text).toContain('AND NOT COALESCE((');
      expect(reader.text).toContain(', FALSE)');
      // The row holds the text of a read that succeeded.
      expect(reader.text).toContain(
        "status = 'active' AND content_hash IS NOT NULL AND last_error IS NULL",
      );
      // That read came after the date, and a margin for a cache.
      expect(reader.text).toContain(
        "last_crawled_at > sitemap_lastmod + interval '1 hour'",
      );
      // And within the week: a sitemap that never moves its dates.
      expect(reader.text).toContain(
        "last_crawled_at > $2::timestamptz - interval '7 days'",
      );
      // Text stored and not indexed yet stays due.
      expect(reader.text).toContain(
        'c.content_hash IS DISTINCT FROM website_urls.content_hash',
      );
    }
  });

  it('records no date on a scan a person started, so every page is requested [KNOW-R16]', async () => {
    const { sql, statements } = corpus();
    vi.mocked(getKnowledgePoolForOrg).mockResolvedValue(sql);

    await scanWebsiteImpl(engineCtx(), { ...SCAN, full: true });

    expect(forgotten(statements).map((statement) => statement.params)).toEqual([
      [SCAN.domain, []],
    ]);
    expect(written(statements)).toEqual([]);
    expect(logged()).toContain('12 URLs discovered');
    expect(logged()).not.toContain('not requested');
  });

  // A later link runs no discovery: it reads the frontier under the dates
  // the first link recorded.
  it('reads the frontier under the same rule on a later link, and records nothing', async () => {
    const { sql, statements } = corpus();
    vi.mocked(getKnowledgePoolForOrg).mockResolvedValue(sql);

    await scanWebsiteImpl(engineCtx(), {
      ...SCAN,
      continuation: 1,
      scanStartedAt: '2026-10-06T13:00:00.000Z',
    });

    expect(safeFetch).not.toHaveBeenCalled();
    expect(forgotten(statements)).toEqual([]);
    expect(written(statements)).toEqual([]);
    expect(frontier(statements)).toHaveLength(2);
  });
});
