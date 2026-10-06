// @vitest-environment node

import { computeContentHash } from '@tale/shared/utils/hashing';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_ROBOTS_POLICY } from '../../../lib/knowledge/crawl-parse';
import { htmlToText } from '../../../lib/knowledge/html-to-text';
import { safeFetchBinary } from '../../../lib/net/safe-fetch';
import type { ActionCtx } from '../lib/ctx';
import { renderUrlsInSandbox } from '../node_only/sandbox/render_fetch';
import {
  checkAfterRender,
  fetchAndStorePage,
  scanWebsiteImpl,
} from './crawl_action';
import { assertCorpusWritable } from './index_health';
import { getKnowledgePoolForOrg } from './pool';

vi.mock('../../../lib/net/safe-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/net/safe-fetch')>()),
  safeFetchBinary: vi.fn(),
}));
vi.mock('../node_only/sandbox/render_fetch', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../node_only/sandbox/render_fetch')
  >()),
  renderUrlsInSandbox: vi.fn(),
}));
vi.mock('./pool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pool')>()),
  getKnowledgePoolForOrg: vi.fn(),
  resolveOrgUrl: vi.fn(async () => 'postgresql://corpus.example/tale'),
}));
// The indexer's gate on a corpus under repair: these tests store text the
// index already holds, so it must never be asked — and never reach for a
// real database when one is.
vi.mock('./index_health', () => ({ assertCorpusWritable: vi.fn() }));

/**
 * A scan asks for each page once and opens the browser only for a page that
 * changed. The regression: the crawler's one way to learn whether a page
 * had changed was to do everything again — fetch it, render it with every
 * image, script and stylesheet the render loads, and compare content hashes
 * afterwards. A 700-page site scanned every six hours answered some 8,000
 * requests and two gigabytes a scan for pages unchanged in months.
 *
 * The request now carries the validators of the last visit, and a 304 ends
 * it. A server that builds its pages on request has no modification time to
 * give — no `ETag`, no `Last-Modified`, a new token in every response — so
 * the text read out of the plain HTML is compared too. A page whose plain
 * HTML does not carry what a browser shows keeps nothing to be checked by:
 * a 304 on such a shell proves nothing, and that page is rendered again.
 *
 * Pinned on recording doubles; what the statements do to real rows rides
 * the integration check.
 */

const DOMAIN = 'docs.example';
const URL = 'https://docs.example/guide';

const body = (words: string, token: string): string =>
  `<html><head><meta name="csrf-token" content="${token}"><title>Guide</title></head><body><main><h1>Guide</h1><p>${words}</p></main><script>window.nonce = "${token}"</script></body></html>`;
const TEXT_V1 =
  'Tale reads the public pages of a website and answers questions from them.';
const TEXT_V2 =
  'Tale reads the public pages of a website, and every changed page again.';
const hashOf = (html: string): string => computeContentHash(htmlToText(html));

interface Statement {
  text: string;
  params: unknown[];
}

function corpus(): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
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

interface Answer {
  status?: number;
  type?: string;
  body?: string | Uint8Array<ArrayBuffer>;
  headers?: Record<string, string>;
  finalUrl?: string;
}

const answers = (answer: Answer): void => {
  vi.mocked(safeFetchBinary).mockResolvedValue({
    status: answer.status ?? 200,
    statusText: answer.status === 304 ? 'Not Modified' : 'OK',
    headers: new Headers({
      'content-type': answer.type ?? 'text/html; charset=utf-8',
      ...answer.headers,
    }),
    body: new Blob([answer.body ?? '']),
    finalUrl: answer.finalUrl ?? URL,
  });
};

/** A page a past scan stored, indexed and left something to check it by. */
const settled = (check: {
  etag?: string | null;
  last_modified?: string | null;
  probe_hash?: string | null;
}) => ({
  url: URL,
  content_hash: 'stored-text-hash',
  listed: false,
  etag: null,
  last_modified: null,
  probe_hash: null,
  indexed: true,
  ...check,
});

const sentHeaders = (): Record<string, string> => {
  const options = vi.mocked(safeFetchBinary).mock.calls[0]?.[1];
  return { ...options?.headers };
};
const stamps = (statements: Statement[]) =>
  statements.filter((statement) =>
    statement.text.includes('last_crawled_at = NOW()'),
  );
const probe = (page: Parameters<typeof fetchAndStorePage>[2]) =>
  fetchAndStorePage(corpus().sql, DOMAIN, page, EMPTY_ROBOTS_POLICY);

beforeEach(() => {
  vi.mocked(safeFetchBinary).mockReset();
  vi.mocked(renderUrlsInSandbox).mockReset();
  vi.mocked(getKnowledgePoolForOrg).mockReset();
  vi.mocked(assertCorpusWritable).mockClear();
  // Cleared: a spy on a method that is already spied on keeps its calls.
  vi.spyOn(console, 'log')
    .mockClear()
    .mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('fetchAndStorePage — asking whether a page changed', () => {
  it('sends the validators of the last settled visit', async () => {
    answers({ status: 304 });

    await probe(
      settled({
        etag: '"v1"',
        last_modified: 'Fri, 10 Jul 2026 09:11:16 GMT',
      }),
    );

    expect(sentHeaders()).toMatchObject({
      'If-None-Match': '"v1"',
      'If-Modified-Since': 'Fri, 10 Jul 2026 09:11:16 GMT',
    });
    expect(sentHeaders()['User-Agent']).toContain('TaleBot/');
  });

  // "Unchanged" would leave a page without text, or with the chunks of its
  // earlier text, exactly as it is.
  it.each([
    ['holds no text', { content_hash: null }],
    ['holds text the index does not have yet', { indexed: false }],
  ])('asks unconditionally for a page whose row %s', async (_case, state) => {
    answers({ body: body(TEXT_V1, 'a') });

    const outcome = await probe({
      ...settled({ etag: '"v1"', probe_hash: hashOf(body(TEXT_V1, 'a')) }),
      ...state,
    });

    expect(sentHeaders()).not.toHaveProperty('If-None-Match');
    expect(outcome).toMatchObject({ kind: 'render' });
  });

  it('leaves a page as it is when the server answers 304 [KNOW-R16]', async () => {
    answers({ status: 304 });
    const { sql, statements } = corpus();

    await expect(
      fetchAndStorePage(
        sql,
        DOMAIN,
        settled({ etag: '"v1"' }),
        EMPTY_ROBOTS_POLICY,
      ),
    ).resolves.toBe('not_modified');

    // One write: the visit, and the end of whatever failure stood before.
    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toContain('last_crawled_at = NOW()');
    expect(statements[0]?.text).toContain('fail_count = 0');
    expect(statements[0]?.text).toContain('last_error = NULL');
    // A 304 brings no validators: the row keeps its own.
    expect(statements[0]?.text).not.toContain('etag');
    expect(statements[0]?.params).toEqual([DOMAIN, URL]);
  });

  it('reads a 304 nobody asked for as the error it is', async () => {
    answers({ status: 304 });
    const { sql, statements } = corpus();

    await expect(
      fetchAndStorePage(sql, DOMAIN, settled({}), EMPTY_ROBOTS_POLICY),
    ).resolves.toBe('failed');

    expect(statements[0]?.params).toContain('http_error');
  });

  // A page that is unchanged is still a page: the gates every response
  // passes come first.
  it('retires an alias and honours X-Robots-Tag on a 304 too', async () => {
    answers({ status: 304, finalUrl: 'https://docs.example/manual' });
    await expect(probe(settled({ etag: '"v1"' }))).resolves.toBe('unchanged');

    answers({ status: 304, headers: { 'x-robots-tag': 'noindex' } });
    await expect(probe(settled({ etag: '"v1"' }))).resolves.toBe('failed');
  });
});

describe('fetchAndStorePage — a server that gives no modification time', () => {
  // Every response of such a server differs in its bytes: a token in a meta
  // tag, a nonce in a script. The text a reader sees is what is compared.
  it('leaves a page as it is when its plain HTML reads as it did [KNOW-R16]', async () => {
    const stored = body(TEXT_V1, 'token-of-the-last-visit');
    const now = body(TEXT_V1, 'token-of-this-visit');
    expect(now).not.toBe(stored);
    answers({ body: now, headers: { etag: '"regenerated"' } });
    const { sql, statements } = corpus();

    await expect(
      fetchAndStorePage(
        sql,
        DOMAIN,
        settled({ probe_hash: hashOf(stored) }),
        EMPTY_ROBOTS_POLICY,
      ),
    ).resolves.toBe('not_modified');

    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toContain('last_crawled_at = NOW()');
    // The validators of THIS response replace the row's.
    expect(statements[0]?.params).toEqual([
      DOMAIN,
      URL,
      '"regenerated"',
      null,
      hashOf(stored),
    ]);
  });

  it('sends a page whose text changed to the browser, with what the request found', async () => {
    const now = body(TEXT_V2, 'b');
    answers({
      body: now,
      headers: { 'last-modified': 'Tue, 06 Oct 2026 08:00:00 GMT' },
    });
    const { sql, statements } = corpus();

    await expect(
      fetchAndStorePage(
        sql,
        DOMAIN,
        settled({ probe_hash: hashOf(body(TEXT_V1, 'a')) }),
        EMPTY_ROBOTS_POLICY,
      ),
    ).resolves.toEqual({
      kind: 'render',
      probe: {
        text: htmlToText(now),
        hash: hashOf(now),
        etag: null,
        lastModified: 'Tue, 06 Oct 2026 08:00:00 GMT',
      },
    });

    // The row stays unmarked until the render batch settles it.
    expect(statements).toEqual([]);
  });

  // A page built by its JavaScript keeps nothing to be checked by: the same
  // shell says nothing about what the page shows.
  it('renders a page only a browser can read on every scan [KNOW-R16]', async () => {
    const shell = body('Loading…', 'a');
    answers({ body: shell, headers: { etag: '"shell"' } });

    await expect(probe(settled({}))).resolves.toMatchObject({
      kind: 'render',
    });
    expect(sentHeaders()).not.toHaveProperty('If-None-Match');
  });

  // The tag can change without a word of the text moving.
  it('still honours a robots meta tag on a page whose text did not change', async () => {
    const stored = body(TEXT_V1, 'a');
    const withdrawn = stored.replace(
      '<title>',
      '<meta name="robots" content="noindex"><title>',
    );
    expect(hashOf(withdrawn)).toBe(hashOf(stored));
    answers({ body: withdrawn });
    const { sql, statements } = corpus();

    await expect(
      fetchAndStorePage(
        sql,
        DOMAIN,
        settled({ probe_hash: hashOf(stored) }),
        EMPTY_ROBOTS_POLICY,
      ),
    ).resolves.toBe('failed');

    expect(
      statements.some((statement) =>
        statement.params.includes('robots_noindex'),
      ),
    ).toBe(true);
    // What it was checked by goes with its content.
    const purge = statements.find((statement) =>
      statement.text.includes('SET content = NULL'),
    );
    expect(purge?.text).toContain(
      'etag = NULL, last_modified = NULL, probe_hash = NULL',
    );
  });

  // Read as UTF-8, every accented word of such a page comes out broken and
  // would never match what the browser shows.
  it('reads a page in the charset its content type names', async () => {
    const html = body('Über die Größe der Änderung', 'a');
    answers({
      type: 'text/html; charset=ISO-8859-1',
      body: Uint8Array.from(Buffer.from(html, 'latin1')),
    });

    await expect(probe(settled({}))).resolves.toMatchObject({
      probe: { hash: hashOf(html) },
    });
  });
});

describe('fetchAndStorePage — a document', () => {
  // A document's bytes are its content, so its validators always hold.
  it('hands the validators of a stored document on, to be kept once it is indexed', async () => {
    answers({
      type: 'text/plain',
      body: 'Release notes. Enough words to be stored as the text of this page.',
      headers: {
        etag: '"doc-1"',
        'last-modified': 'Fri, 10 Jul 2026 09:11:16 GMT',
      },
    });
    const { sql, statements } = corpus();

    await expect(
      fetchAndStorePage(
        sql,
        DOMAIN,
        { url: URL, content_hash: null, listed: false },
        EMPTY_ROBOTS_POLICY,
      ),
    ).resolves.toEqual({
      kind: 'stored',
      outcome: 'changed',
      check: {
        etag: '"doc-1"',
        lastModified: 'Fri, 10 Jul 2026 09:11:16 GMT',
        probeHash: null,
      },
    });

    // Stored, not yet stamped: the scan indexes it first.
    expect(stamps(statements)).toEqual([]);
  });

  it('is not downloaded again when the server answers 304', async () => {
    answers({ status: 304, type: 'application/pdf' });

    await expect(probe(settled({ etag: '"doc-1"' }))).resolves.toBe(
      'not_modified',
    );
  });
});

describe('checkAfterRender', () => {
  const plain = htmlToText(body(TEXT_V1, 'a'));
  const found = {
    text: plain,
    hash: computeContentHash(plain),
    etag: '"v2"',
    lastModified: null,
  };

  it('keeps what the request found when the plain HTML carried what the browser showed', () => {
    expect(checkAfterRender(found, plain)).toEqual({
      etag: '"v2"',
      lastModified: null,
      probeHash: found.hash,
    });
  });

  it.each([
    [
      'the browser showed a page its plain HTML does not carry',
      found,
      `${TEXT_V2} ${TEXT_V2} A long article that only the page's own scripts fetched and rendered for the reader.`,
    ],
    [
      'the plain HTML was too large to read',
      { ...found, text: null, hash: null },
      plain,
    ],
  ])('keeps nothing when %s', (_case, probed, rendered) => {
    expect(checkAfterRender(probed, rendered)).toEqual({
      etag: null,
      lastModified: null,
      probeHash: null,
    });
  });
});

/**
 * One link of a scan, on a later link (no discovery): the frontier hands it
 * one page, whose request says it changed.
 */
describe('scanWebsiteImpl — a page that changed', () => {
  const SCAN = {
    domain: DOMAIN,
    orgSlug: 'acme',
    organizationId: 'org-1',
    continuation: 1,
    scanStartedAt: '2026-10-06T13:00:00.000Z',
  };

  /** The frontier holds `page` once; its stored text is already what the
   * browser shows, so storing it changes nothing in the index. */
  function scanCorpus(page: Record<string, unknown>): {
    sql: Sql;
    statements: Statement[];
  } {
    const statements: Statement[] = [];
    let handed = false;
    const unsafe = (
      text: string,
      params: unknown[] = [],
    ): Promise<unknown[]> => {
      const statement = text.replace(/\s+/g, ' ').trim();
      statements.push({ text: statement, params });
      if (statement.startsWith('SELECT kind')) {
        return Promise.resolve([{ kind: 'site', robots_disallow: null }]);
      }
      if (statement.startsWith('SELECT url, content_hash, listed')) {
        if (handed) return Promise.resolve([]);
        handed = true;
        return Promise.resolve([page]);
      }
      if (statement.includes('bool_or(embedding IS NULL)')) {
        return Promise.resolve([
          { present: true, current: true, vectorless: false },
        ]);
      }
      if (statement.includes('FILTER (WHERE u.status')) {
        return Promise.resolve([
          { stored: '1', attempted: '1', failed: '0', skipped: '0' },
        ]);
      }
      return Promise.resolve([]);
    };
    const sql = {
      unsafe,
      begin: async (run: (tx: { unsafe: typeof unsafe }) => Promise<void>) =>
        run({ unsafe }),
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

  const shows = (html: string): void => {
    vi.mocked(renderUrlsInSandbox).mockResolvedValue({
      outcomes: new Map([
        [URL, { kind: 'ok', status: 200, finalUrl: URL, html }],
      ]),
      halted: null,
    });
  };
  const settledWrite = (statements: Statement[]) =>
    statements.find(
      (statement) =>
        statement.text.includes('last_crawled_at = NOW()') &&
        statement.text.includes('probe_hash = $5'),
    );

  it('reads what a page is checked by out of the frontier, with whether its text is indexed', async () => {
    const { sql, statements } = scanCorpus(settled({}));
    vi.mocked(getKnowledgePoolForOrg).mockResolvedValue(sql);
    answers({ status: 304 });

    await scanWebsiteImpl(engineCtx(), SCAN);

    const frontier = statements.find((statement) =>
      statement.text.startsWith('SELECT url, content_hash, listed'),
    );
    expect(frontier?.text).toContain('etag, last_modified, probe_hash');
    expect(frontier?.text).toContain(
      'c.content_hash IS DISTINCT FROM website_urls.content_hash ) AS indexed',
    );
  });

  it('opens no browser for a page that did not change [KNOW-R16]', async () => {
    const { sql } = scanCorpus(settled({ etag: '"v1"' }));
    vi.mocked(getKnowledgePoolForOrg).mockResolvedValue(sql);
    answers({ status: 304 });

    await scanWebsiteImpl(engineCtx(), SCAN);

    expect(renderUrlsInSandbox).not.toHaveBeenCalled();
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(
      '1 page(s) requested, 1 unchanged, 0 rendered',
    );
  });

  it('renders a changed page and keeps what to check it by next time', async () => {
    const now = body(TEXT_V2, 'b');
    const { sql, statements } = scanCorpus({
      ...settled({ probe_hash: hashOf(body(TEXT_V1, 'a')) }),
      // The row already stores what the browser is about to show (an
      // earlier scan stored it and stopped before stamping the visit), so
      // the store finds nothing to index.
      content_hash: hashOf(now),
    });
    vi.mocked(getKnowledgePoolForOrg).mockResolvedValue(sql);
    answers({ body: now, headers: { etag: '"v2"' } });
    // The browser shows what the plain HTML already said.
    shows(now);

    await scanWebsiteImpl(engineCtx(), SCAN);

    expect(renderUrlsInSandbox).toHaveBeenCalledTimes(1);
    expect(assertCorpusWritable).not.toHaveBeenCalled();
    expect(settledWrite(statements)?.params).toEqual([
      DOMAIN,
      URL,
      '"v2"',
      null,
      hashOf(now),
    ]);
  });

  it('keeps nothing to check a page by when only the browser could read it', async () => {
    const shell = body('Loading…', 'a');
    const shown = body(
      `${TEXT_V1} ${TEXT_V2} A long article that only the page's own scripts fetched and rendered for the reader.`,
      'a',
    );
    const { sql, statements } = scanCorpus({
      ...settled({}),
      content_hash: hashOf(shown),
    });
    vi.mocked(getKnowledgePoolForOrg).mockResolvedValue(sql);
    answers({ body: shell, headers: { etag: '"shell"' } });
    shows(shown);

    await scanWebsiteImpl(engineCtx(), SCAN);

    expect(assertCorpusWritable).not.toHaveBeenCalled();
    expect(settledWrite(statements)?.params).toEqual([
      DOMAIN,
      URL,
      null,
      null,
      null,
    ]);
  });
});
