// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_ROBOTS_POLICY } from '../../../lib/knowledge/crawl-parse';
import { safeFetchBinary } from '../../../lib/net/safe-fetch';
import { fetchAndStorePage } from './crawl_action';

vi.mock('../../../lib/net/safe-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/net/safe-fetch')>()),
  safeFetchBinary: vi.fn(),
}));

/**
 * A redirect inside the site makes a URL another page's alias. The
 * regression: the probe followed it and the page was stored under the
 * address that was asked for, so a site registered as `www.` whose host
 * redirects to the apex had its homepage indexed twice (the sitemap lists
 * the apex one), as did every `/page` beside its `/page/` and every removed
 * page sent to the homepage — the same chunks, embedded and cited twice.
 */

const DOMAIN = 'www.example.com';

/** A corpus double recording every statement with its parameters. */
function corpus(): {
  sql: Sql;
  statements: { text: string; params: unknown[] }[];
} {
  const statements: { text: string; params: unknown[] }[] = [];
  const unsafe = (text: string, params: unknown[] = []): Promise<unknown[]> => {
    statements.push({ text: text.replace(/\s+/g, ' ').trim(), params });
    return Promise.resolve(text.includes('RETURNING u.url') ? [{}] : []);
  };
  const sql = {
    unsafe,
    begin: async (run: (tx: { unsafe: typeof unsafe }) => Promise<void>) =>
      run({ unsafe }),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, statements };
}

const answers = (finalUrl: string): void => {
  vi.mocked(safeFetchBinary).mockResolvedValue({
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    body: new Blob(['<html></html>']),
    finalUrl,
  });
};

const page = (url: string, listed = false) => ({
  url,
  content_hash: null,
  listed,
});

const retired = (statements: { text: string; params: unknown[] }[]) =>
  statements
    .filter((statement) => statement.text.includes("SET status = 'deleted'"))
    .map((statement) => statement.params[1]);

const admitted = (statements: { text: string; params: unknown[] }[]) =>
  statements
    .filter((statement) => statement.text.includes('RETURNING u.url'))
    .flatMap((statement) => statement.params.slice(1));

beforeEach(() => {
  vi.mocked(safeFetchBinary).mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('fetchAndStorePage — a redirect inside the site', () => {
  it.each([
    [
      'the www host onto the apex',
      'https://www.example.com/',
      'https://example.com/',
    ],
    [
      'a missing trailing slash',
      'https://www.example.com/about',
      'https://www.example.com/about/',
    ],
    [
      'a removed page sent to the homepage',
      'https://www.example.com/old',
      'https://www.example.com/',
    ],
  ])('retires the alias and tracks its target: %s', async (_case, from, to) => {
    answers(to);
    const { sql, statements } = corpus();

    await expect(
      fetchAndStorePage(sql, DOMAIN, page(from), EMPTY_ROBOTS_POLICY),
    ).resolves.toBe('unchanged');

    expect(retired(statements)).toEqual([from]);
    expect(admitted(statements)).toEqual([to]);
  });

  // Within a scan, the target of a redirect may be a row this scan already
  // retired; that one stays retired (`admitUrlsStatement`, fenced).
  it("admits the target under the scan's start when the scan names it", async () => {
    answers('https://www.example.com/about/');
    const { sql, statements } = corpus();
    const scanStartedAt = '2026-09-30T12:00:00.000Z';

    await fetchAndStorePage(
      sql,
      DOMAIN,
      page('https://www.example.com/about'),
      EMPTY_ROBOTS_POLICY,
      scanStartedAt,
    );

    const admit = statements.find((statement) =>
      statement.text.includes('RETURNING u.url'),
    );
    expect(admit?.params).toEqual([
      DOMAIN,
      'https://www.example.com/about/',
      scanStartedAt,
    ]);
    expect(admit?.text).toContain('u.last_crawled_at < $3::timestamptz');
  });

  it('does not track a target robots.txt disallows [KNOW-R14]', async () => {
    answers('https://www.example.com/private/login');
    const { sql, statements } = corpus();

    await fetchAndStorePage(
      sql,
      DOMAIN,
      page('https://www.example.com/account'),
      {
        ...EMPTY_ROBOTS_POLICY,
        disallow: ['/private/'],
      },
    );

    expect(retired(statements)).toEqual(['https://www.example.com/account']);
    expect(admitted(statements)).toEqual([]);
  });

  it.each([
    [
      'no redirect at all',
      'https://www.example.com/a',
      'https://www.example.com/a',
      false,
    ],
    // A session id or a language parameter is the same address: following
    // it would mint a new row every scan.
    [
      'a redirect that only rewrites the query',
      'https://www.example.com/a',
      'https://www.example.com/a?sid=1',
      false,
    ],
    // The operator asked for this address by name.
    [
      'a listed URL that redirects',
      'https://www.example.com/a',
      'https://example.com/a',
      true,
    ],
  ])(
    'keeps the page under its own address: %s',
    async (_case, from, to, listed) => {
      answers(to);
      const { sql, statements } = corpus();

      await expect(
        fetchAndStorePage(sql, DOMAIN, page(from, listed), EMPTY_ROBOTS_POLICY),
      ).resolves.toBe('render');

      expect(retired(statements)).toEqual([]);
      expect(admitted(statements)).toEqual([]);
    },
  );
});

/**
 * What the crawler will not request at all. Both refusals are decided from
 * the page's own address before anything is dialed, so a row an earlier
 * release admitted, or a rule the site added since, cannot launder a fetch.
 */
describe('fetchAndStorePage — a page the crawler does not request', () => {
  const PRIVATE_RULE = { ...EMPTY_ROBOTS_POLICY, disallow: ['/private/'] };

  /** The kind of every failure recorded on a page row. */
  const failureKinds = (statements: { text: string; params: unknown[] }[]) =>
    statements
      .filter((statement) => statement.text.includes('last_error_kind = $4'))
      .map((statement) => statement.params[3]);

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('never requests a page robots.txt disallows, and takes it out of the index [KNOW-R14]', async () => {
    const { sql, statements } = corpus();
    const url = 'https://www.example.com/private/report';

    await expect(
      fetchAndStorePage(sql, DOMAIN, page(url), PRIVATE_RULE),
    ).resolves.toBe('unchanged');

    expect(safeFetchBinary).not.toHaveBeenCalled();
    expect(retired(statements)).toEqual([url]);
  });

  it('still requests a disallowed address the source lists by name [KNOW-R14]', async () => {
    const url = 'https://www.example.com/private/report';
    answers(url);
    const { sql, statements } = corpus();

    await expect(
      fetchAndStorePage(sql, DOMAIN, page(url, true), PRIVATE_RULE),
    ).resolves.toBe('render');

    expect(safeFetchBinary).toHaveBeenCalledTimes(1);
    expect(retired(statements)).toEqual([]);
  });

  it.each([
    ['a private network address', '10.0.0.5'],
    ['this machine', 'localhost'],
    ['a name that only resolves inside a company network', 'intranet.corp'],
  ])(
    'never requests a page on %s, and records why [KNOW-R15]',
    async (_case, host) => {
      const { sql, statements } = corpus();

      await expect(
        fetchAndStorePage(
          sql,
          host,
          page(`https://${host}/wiki`),
          EMPTY_ROBOTS_POLICY,
        ),
      ).resolves.toBe('failed');

      expect(safeFetchBinary).not.toHaveBeenCalled();
      expect(failureKinds(statements)).toEqual(['private_ip']);
    },
  );

  it('requests it once the operator has allowed private networks for the crawler [KNOW-R15]', async () => {
    vi.stubEnv('TALE_ALLOW_PRIVATE_CRAWL_HOSTS', '1');
    const url = 'https://intranet.corp/wiki';
    answers(url);
    const { sql, statements } = corpus();

    await expect(
      fetchAndStorePage(sql, 'intranet.corp', page(url), EMPTY_ROBOTS_POLICY),
    ).resolves.toBe('render');

    expect(safeFetchBinary).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ allowPrivateAddresses: true }),
    );
    expect(failureKinds(statements)).toEqual([]);
  });
});
