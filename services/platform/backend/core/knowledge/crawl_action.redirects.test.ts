// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('does not track a target robots.txt disallows', async () => {
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
