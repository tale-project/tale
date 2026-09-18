import { describe, expect, it } from 'vitest';

import {
  classifyRenderReason,
  discoverableLinks,
  EMPTY_ROBOTS_POLICY,
  isUrlDisallowed,
  MAX_CRAWL_DELAY_MS,
  publicPageError,
  robotsMetaNoindexDirective,
  robotsPolicyFromStored,
  robotsPolicyToStored,
  type RobotsPolicy,
  classifyContentType,
  documentNameForUrl,
  extractLinks,
  isDisallowed,
  isSitemapIndex,
  metaDescription,
  normalizeCandidateUrl,
  normalizeListedUrl,
  paragraphsForHashing,
  parseRobots,
  parseSitemapLocs,
  robotsHeaderForbidsIndexing,
  siteHosts,
  stripBoilerplate,
} from './crawl-parse';

/**
 * The crawler's judgment calls, pinned: which robots rules bind, which URLs
 * count as the same site, and which paragraphs the boilerplate ledger can
 * drop. Each of these is a decision the live web would only exercise
 * accidentally.
 */

/** A policy of `Disallow` rules and, when given, `Allow` rules. */
const policy = (
  disallow: readonly string[],
  allow: readonly string[] = [],
): RobotsPolicy => ({ allow, disallow, crawlDelayMs: 0 });

describe('parseRobots', () => {
  it('binds the * group when no group names the crawler, and collects sitemaps', () => {
    const rules = parseRobots(
      [
        'User-agent: GPTBot',
        'Disallow: /',
        '',
        'User-agent: *',
        'Disallow: /admin/ # keep out',
        'Disallow: /*.pdf',
        'Sitemap: https://example.com/sitemap.xml',
        'Sitemap: https://example.com/news-sitemap.xml',
      ].join('\n'),
      'TaleBot',
    );
    expect(rules.disallow).toEqual(['/admin/', '/*.pdf']);
    expect(rules.allow).toEqual([]);
    expect(rules.crawlDelayMs).toBe(0);
    expect(rules.sitemaps).toEqual([
      'https://example.com/sitemap.xml',
      'https://example.com/news-sitemap.xml',
    ]);
  });

  /**
   * The documented opt-out: a group that names `TaleBot` binds this crawler
   * ALONE, whatever the `*` group says — a site that wrote one to refuse the
   * crawler was crawled under the `*` rules instead (2026-09-18 evaluation,
   * J6-4). The token matches case-insensitively (RFC 9309 §2.2.1).
   */
  it('binds the group that names the crawler instead of the * group, case-insensitively', () => {
    const rules = parseRobots(
      [
        'User-agent: *',
        'Disallow: /blocked/',
        'Crawl-delay: 10',
        '',
        'User-agent: talebot',
        'Disallow: /p/',
        'Allow: /p/open',
        'Crawl-delay: 2.5',
      ].join('\n'),
      'TaleBot',
    );
    expect(rules.disallow).toEqual(['/p/']);
    expect(rules.allow).toEqual(['/p/open']);
    expect(rules.crawlDelayMs).toBe(2500);
  });

  it('merges every group that names the crawler, and a group with several agent lines is one group', () => {
    const rules = parseRobots(
      [
        'User-agent: TaleBot',
        'User-agent: OtherBot',
        'Disallow: /a/',
        '',
        'User-agent: TaleBot',
        'Disallow: /b/',
        'Crawl-delay: 1',
        '',
        'User-agent: *',
        'Disallow: /',
      ].join('\r\n'),
      'TaleBot',
    );
    expect(rules.disallow).toEqual(['/a/', '/b/']);
    expect(rules.crawlDelayMs).toBe(1000);
  });

  it('lets a named group allow the crawler alone under a * group that refuses everyone', () => {
    const rules = parseRobots(
      [
        'User-agent: *',
        'Disallow: /',
        '',
        'User-agent: TaleBot',
        'Allow: /',
      ].join('\n'),
      'TaleBot',
    );
    expect(rules.disallow).toEqual([]);
    expect(rules.allow).toEqual(['/']);
    expect(isUrlDisallowed('https://example.com/any', rules)).toBe(false);
  });

  it('ignores rules ahead of the first group, and caps an oversized or unparsable Crawl-delay', () => {
    expect(
      parseRobots('Disallow: /\nUser-agent: *\nCrawl-delay: 600', 'TaleBot'),
    ).toMatchObject({ disallow: [], crawlDelayMs: MAX_CRAWL_DELAY_MS });
    expect(
      parseRobots('User-agent: *\nCrawl-delay: soon\nDisallow: /x', 'TaleBot'),
    ).toMatchObject({ disallow: ['/x'], crawlDelayMs: 0 });
  });

  it('returns nothing for an empty or comment-only file', () => {
    expect(parseRobots('# nothing here\n', 'TaleBot')).toEqual({
      allow: [],
      disallow: [],
      crawlDelayMs: 0,
      sitemaps: [],
    });
  });
});

describe('isDisallowed', () => {
  it('matches plain prefixes', () => {
    expect(isDisallowed('/admin/users', policy(['/admin/']))).toBe(true);
    expect(isDisallowed('/about', policy(['/admin/']))).toBe(false);
  });

  it('honours the * wildcard extension', () => {
    expect(isDisallowed('/files/report.pdf', policy(['/*.pdf']))).toBe(true);
    expect(isDisallowed('/files/report.html', policy(['/*.pdf']))).toBe(false);
  });

  /** RFC 9309 §2.2.3: a trailing `$` anchors the end of the path — it used
   * to be matched as a literal, so `Disallow: /*.pdf$` blocked nothing. */
  it('honours the $ end anchor, and reads a $ elsewhere as a literal', () => {
    expect(isDisallowed('/files/report.pdf', policy(['/*.pdf$']))).toBe(true);
    expect(isDisallowed('/files/report.pdf?dl=1', policy(['/*.pdf$']))).toBe(
      false,
    );
    expect(isDisallowed('/a$b/x', policy(['/a$b/']))).toBe(true);
  });

  /** RFC 9309 §2.2.2: the most specific rule wins, an `Allow` of equal
   * length wins the tie — `Allow` used to be ignored altogether. */
  it('lets the longest matching rule decide, Allow winning a tie', () => {
    const rules = policy(
      ['/', '/docs/private/'],
      ['/docs/', '/docs/private/x'],
    );
    expect(isDisallowed('/about', rules)).toBe(true);
    expect(isDisallowed('/docs/guide', rules)).toBe(false);
    expect(isDisallowed('/docs/private/secret', rules)).toBe(true);
    expect(isDisallowed('/docs/private/x1', rules)).toBe(false);
    expect(isDisallowed('/p', policy(['/p'], ['/p']))).toBe(false);
  });
});

describe('the stored robots policy', () => {
  it('reads the object form, the legacy Disallow array, and nothing else', () => {
    const stored = robotsPolicyToStored({
      allow: ['/a'],
      disallow: ['/b'],
      crawlDelayMs: 1500,
    });
    expect(robotsPolicyFromStored(stored)).toEqual({
      allow: ['/a'],
      disallow: ['/b'],
      crawlDelayMs: 1500,
    });
    expect(robotsPolicyFromStored(['/private/'])).toEqual({
      allow: [],
      disallow: ['/private/'],
      crawlDelayMs: 0,
    });
    expect(robotsPolicyFromStored(null)).toEqual(EMPTY_ROBOTS_POLICY);
    expect(robotsPolicyFromStored({ crawlDelayMs: 10 ** 9, allow: 3 })).toEqual(
      {
        allow: [],
        disallow: [],
        crawlDelayMs: MAX_CRAWL_DELAY_MS,
      },
    );
  });
});

describe('sitemap parsing', () => {
  it('extracts locs, including CDATA-wrapped ones', () => {
    const xml = `<?xml version="1.0"?>
      <urlset><url><loc>https://a.example/x</loc></url>
      <url><loc><![CDATA[https://a.example/y]]></loc></url></urlset>`;
    expect(parseSitemapLocs(xml)).toEqual([
      'https://a.example/x',
      'https://a.example/y',
    ]);
  });

  it('decodes entity-escaped locs — query-string sitemap URLs 404 raw', () => {
    // TYPO3 et al. publish child sitemaps as query URLs; XML requires the
    // `&` to be written `&amp;`, and fetching it undecoded is a different
    // (dead) URL. Regression for the gematik.de discovery collapse.
    const xml = `<sitemapindex><sitemap>
      <loc>https://a.example/?sitemap=news&amp;type=1533906435&amp;cHash=afdf</loc>
      </sitemap><sitemap>
      <loc>https://a.example/?p=1&#38;q=2&#x26;r=3</loc>
      </sitemap></sitemapindex>`;
    expect(parseSitemapLocs(xml)).toEqual([
      'https://a.example/?sitemap=news&type=1533906435&cHash=afdf',
      'https://a.example/?p=1&q=2&r=3',
    ]);
  });

  it('leaves CDATA locs literal — CDATA content is not entity-encoded', () => {
    const xml = `<urlset><url>
      <loc><![CDATA[https://a.example/?a=1&amp;b=2]]></loc>
      </url></urlset>`;
    expect(parseSitemapLocs(xml)).toEqual(['https://a.example/?a=1&amp;b=2']);
  });

  it('tells a sitemap index apart from a urlset', () => {
    expect(isSitemapIndex('<sitemapindex><sitemap>…')).toBe(true);
    expect(isSitemapIndex('<urlset><url>…')).toBe(false);
  });
});

describe('extractLinks', () => {
  it('reads single- and double-quoted hrefs', () => {
    expect(
      extractLinks(`<a href="/a">A</a> <a class="x" href='/b?q=1'>B</a>`),
    ).toEqual(['/a', '/b?q=1']);
  });

  it('decodes entity-escaped hrefs — attributes are encoded by spec', () => {
    expect(
      extractLinks(
        `<a href="/search?a=1&amp;b=2">S</a> <a href='/x?y=&#38;z'>X</a>`,
      ),
    ).toEqual(['/search?a=1&b=2', '/x?y=&z']);
  });
});

describe('normalizeCandidateUrl', () => {
  // A registration names a hostname, never a port: a same-host link to a
  // non-standard port is another service (2026-09-14 evaluation, g4-6).
  it('drops a same-host link that names a port', () => {
    const portHosts = new Set(['info.cern.ch']);
    expect(
      normalizeCandidateUrl(
        'http://info.cern.ch:8001/cedar.cic.net:210/usenet-addresses?',
        'https://info.cern.ch/',
        portHosts,
      ),
    ).toBeNull();
    expect(
      normalizeCandidateUrl(
        '/hypertext/WWW/TheProject.html',
        'https://info.cern.ch/',
        portHosts,
      ),
    ).toBe('https://info.cern.ch/hypertext/WWW/TheProject.html');
    expect(
      normalizeListedUrl('https://info.cern.ch:8443/admin', portHosts),
    ).toBeNull();
  });

  const hosts = siteHosts('www.example.com');

  it('resolves relative links, drops fragments, keeps queries', () => {
    expect(
      normalizeCandidateUrl('/pricing#top', 'https://www.example.com/', hosts),
    ).toBe('https://www.example.com/pricing');
    expect(
      normalizeCandidateUrl('?page=2', 'https://www.example.com/blog', hosts),
    ).toBe('https://www.example.com/blog?page=2');
  });

  it('accepts the apex/www sibling and rejects foreign hosts', () => {
    expect(
      normalizeCandidateUrl(
        'https://example.com/about',
        'https://www.example.com/',
        hosts,
      ),
    ).toBe('https://example.com/about');
    expect(
      normalizeCandidateUrl(
        'https://other.com/about',
        'https://www.example.com/',
        hosts,
      ),
    ).toBeNull();
  });

  it('upgrades plaintext http to https', () => {
    expect(
      normalizeCandidateUrl(
        'http://www.example.com/legacy',
        'https://www.example.com/',
        hosts,
      ),
    ).toBe('https://www.example.com/legacy');
  });

  it('rejects non-http schemes and asset suffixes', () => {
    expect(
      normalizeCandidateUrl(
        'mailto:x@example.com',
        'https://www.example.com/',
        hosts,
      ),
    ).toBeNull();
    expect(
      normalizeCandidateUrl('/logo.svg', 'https://www.example.com/', hosts),
    ).toBeNull();
  });

  it('admits extractable documents but drops legacy Office formats', () => {
    expect(
      normalizeCandidateUrl(
        '/reports/annual.pdf',
        'https://www.example.com/',
        hosts,
      ),
    ).toBe('https://www.example.com/reports/annual.pdf');
    expect(
      normalizeCandidateUrl('/notes.docx', 'https://www.example.com/', hosts),
    ).toBe('https://www.example.com/notes.docx');
    expect(
      normalizeCandidateUrl('/notes.doc', 'https://www.example.com/', hosts),
    ).toBeNull();
    expect(
      normalizeCandidateUrl('/sheet.xls', 'https://www.example.com/', hosts),
    ).toBeNull();
  });
});

describe('normalizeListedUrl', () => {
  const hosts = siteHosts('www.fedlex.admin.ch');

  it('keeps entries discovery would suffix-filter — the list is explicit', () => {
    expect(
      normalizeListedUrl('https://www.fedlex.admin.ch/notes.doc', hosts),
    ).toBe('https://www.fedlex.admin.ch/notes.doc');
  });

  it('rejects foreign hosts and non-http schemes', () => {
    expect(normalizeListedUrl('https://other.ch/a', hosts)).toBeNull();
    expect(normalizeListedUrl('ftp://www.fedlex.admin.ch/a', hosts)).toBeNull();
  });

  it('trims, upgrades plaintext http, and drops fragments', () => {
    expect(
      normalizeListedUrl(
        '  http://fedlex.admin.ch/eli/cc/2009/615/de#art5 ',
        hosts,
      ),
    ).toBe('https://fedlex.admin.ch/eli/cc/2009/615/de');
  });
});

describe('classifyContentType', () => {
  it('routes html and text types, ignoring charset parameters', () => {
    expect(classifyContentType('text/html; charset=utf-8')).toEqual({
      kind: 'html',
    });
    expect(classifyContentType('application/xhtml+xml')).toEqual({
      kind: 'html',
    });
    expect(classifyContentType('text/plain')).toEqual({ kind: 'text' });
  });

  it('treats a missing header as a text page, the pre-dispatch behavior', () => {
    expect(classifyContentType('')).toEqual({ kind: 'html' });
  });

  it('maps document mime types to the extension the router keys on', () => {
    expect(classifyContentType('application/pdf')).toEqual({
      kind: 'document',
      extension: '.pdf',
    });
    expect(
      classifyContentType(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toEqual({ kind: 'document', extension: '.docx' });
  });

  it('skips everything the lane cannot turn into text', () => {
    expect(classifyContentType('image/png')).toEqual({ kind: 'skip' });
    expect(classifyContentType('application/octet-stream')).toEqual({
      kind: 'skip',
    });
    expect(classifyContentType('application/zip')).toEqual({ kind: 'skip' });
    expect(classifyContentType('text/css')).toEqual({ kind: 'skip' });
  });
});

describe('documentNameForUrl', () => {
  it('keeps a matching path basename and decodes escapes', () => {
    expect(
      documentNameForUrl('https://x.ch/dam/52_15_steuers%C3%A4tze.pdf', '.pdf'),
    ).toBe('52_15_steuersätze.pdf');
  });

  it('forces the mime-derived extension over the path claim', () => {
    expect(documentNameForUrl('https://x.ch/download?id=7', '.pdf')).toBe(
      'download.pdf',
    );
    expect(documentNameForUrl('https://x.ch/report.php', '.docx')).toBe(
      'report.php.docx',
    );
  });

  it('falls back to a generic name for bare hosts', () => {
    expect(documentNameForUrl('https://x.ch/', '.pdf')).toBe('document.pdf');
  });
});

describe('boilerplate', () => {
  const long = (seed: string) =>
    `${seed} ${'lorem ipsum dolor sit amet consectetur adipiscing elit sed do'.repeat(2)}`;

  it('hashes only paragraphs long enough to be content', () => {
    const text = `Home\n\n${long('About our company.')}\n\nContact`;
    expect(paragraphsForHashing(text)).toEqual([long('About our company.')]);
  });

  it('drops ledgered paragraphs and keeps the rest', () => {
    const footer = long('© Example Corp. All rights reserved.');
    const body = long('The actual article body.');
    const hash = (p: string) => `h:${p.length}:${p.slice(0, 8)}`;
    const stripped = stripBoilerplate(
      `${body}\n\n${footer}`,
      new Set([hash(footer)]),
      hash,
    );
    expect(stripped).toContain(body);
    expect(stripped).not.toContain(footer);
  });

  it('never drops short paragraphs, even matching ones', () => {
    const hash = () => 'same';
    expect(
      stripBoilerplate('Short.\n\nAlso short.', new Set(['same']), hash),
    ).toBe('Short.\n\nAlso short.');
  });
});

describe('metaDescription', () => {
  it('prefers name=description and falls back to og:description', () => {
    expect(
      metaDescription(
        `<meta name="description" content="Plain one"><meta property="og:description" content="OG one">`,
      ),
    ).toBe('Plain one');
    expect(
      metaDescription(`<meta property="og:description" content="OG only">`),
    ).toBe('OG only');
    expect(metaDescription('<title>No metas</title>')).toBeNull();
  });

  it('handles reversed attribute order', () => {
    expect(
      metaDescription(`<meta content="Reversed" name="description">`),
    ).toBe('Reversed');
  });
});

describe('robotsHeaderForbidsIndexing', () => {
  it('honours noindex and none, in any case, under any agent prefix', () => {
    expect(robotsHeaderForbidsIndexing('noindex')).toBe(true);
    expect(robotsHeaderForbidsIndexing('NOINDEX, nofollow')).toBe(true);
    expect(robotsHeaderForbidsIndexing('none')).toBe(true);
    expect(robotsHeaderForbidsIndexing('*: noindex')).toBe(true);
    expect(
      robotsHeaderForbidsIndexing('googlebot: nofollow, tale: noindex'),
    ).toBe(true);
  });

  it('lets an absent header and every other directive through', () => {
    expect(robotsHeaderForbidsIndexing(null)).toBe(false);
    expect(robotsHeaderForbidsIndexing('')).toBe(false);
    expect(robotsHeaderForbidsIndexing('nofollow, noarchive')).toBe(false);
    expect(robotsHeaderForbidsIndexing('index, follow')).toBe(false);
    expect(robotsHeaderForbidsIndexing('max-snippet:0')).toBe(false);
  });
});

describe('isUrlDisallowed', () => {
  const rules = policy(['/legal/', '/search?q=', '/tmp/*.pdf']);

  it.each([
    ['https://example.com/legal/terms', true],
    ['https://example.com/legal', false],
    ['https://example.com/search?q=x', true],
    ['https://example.com/search', false],
    ['https://example.com/tmp/report.pdf', true],
    ['https://example.com/about', false],
  ])('%s → %s', (url, expected) => {
    expect(isUrlDisallowed(url, rules)).toBe(expected);
  });

  it('blocks nothing with no rules, and nothing that does not parse', () => {
    expect(
      isUrlDisallowed('https://example.com/legal/terms', EMPTY_ROBOTS_POLICY),
    ).toBe(false);
    expect(isUrlDisallowed('not a url', rules)).toBe(false);
  });
});

/**
 * The one seam every admission path shares. The regression under test: the
 * rendered-page admission ran host and asset rules only, so every disallowed
 * link a rendered page carried joined the frontier (2026-09-14 evaluation,
 * h5).
 */
describe('discoverableLinks', () => {
  const hosts = new Set(['example.com', 'www.example.com']);
  const html = `
    <a href="/legal/terms-of-service">Terms</a>
    <a href="https://example.com/de/legal/privacy-policy">Datenschutz</a>
    <a href="/pricing">Pricing</a>
    <a href="/pricing#plans">Plans</a>
    <a href="https://www.example.com/docs">Docs</a>
    <a href="https://other.example/x">Elsewhere</a>
    <a href="/logo.png">Logo</a>
    <a href="https://example.com:8001/gateway">Port</a>
    <a href="/private/report">Report</a>
  `;

  it('drops a link a plain or wildcard rule covers and keeps the rest, de-duplicated', () => {
    expect(
      discoverableLinks(
        html,
        'https://example.com/',
        hosts,
        policy(['/legal/', '/*/legal/', '/private/*']),
      ),
    ).toEqual(['https://example.com/pricing', 'https://www.example.com/docs']);
  });

  it('applies the host, port and asset rules with no robots rules', () => {
    expect(
      discoverableLinks(
        html,
        'https://example.com/',
        hosts,
        EMPTY_ROBOTS_POLICY,
      ),
    ).toEqual([
      'https://example.com/legal/terms-of-service',
      'https://example.com/de/legal/privacy-policy',
      'https://example.com/pricing',
      'https://www.example.com/docs',
      'https://example.com/private/report',
    ]);
  });
});

describe('robotsMetaNoindexDirective', () => {
  it.each([
    ['<meta name="robots" content="noindex, follow">', 'noindex, follow'],
    ['<meta content="none" name="robots">', 'none'],
    ["<meta name='robots' content='NOINDEX'>", 'NOINDEX'],
    ['<META NAME="Robots" CONTENT="index, noindex">', 'index, noindex'],
    ['<meta name=robots content=noindex>', 'noindex'],
  ])('reads %s as a noindex wish', (tag, expected) => {
    expect(
      robotsMetaNoindexDirective(
        `<html><head>${tag}</head><body>x</body></html>`,
      ),
    ).toBe(expected);
  });

  it.each([
    '<meta name="robots" content="index, follow">',
    '<meta name="googlebot" content="noindex">',
    '<meta name="description" content="noindex is a word here">',
    '',
  ])('reads %s as no wish', (tag) => {
    expect(
      robotsMetaNoindexDirective(
        `<html><head>${tag}</head><body>x</body></html>`,
      ),
    ).toBeNull();
  });
});

describe('publicPageError', () => {
  it('keeps the first line of a browser call log', () => {
    expect(
      publicPageError(
        'page.goto: Timeout 20000ms exceeded.\nCall log:\n  - navigating to "https://neverssl.com/", waiting until "domcontentloaded"',
      ),
    ).toBe('page.goto: Timeout 20000ms exceeded.');
  });

  it('drops the OpenSSL handle and source path from a TLS alert', () => {
    expect(
      publicPageError(
        'TLS handshake failed: C08C3904E37E0000:error:0A000410:SSL routines:ssl3_read_bytes:ssl/tls alert handshake failure:../deps/openssl/openssl/ssl/record/rec_layer_s3.c:916:SSL alert number 40 (ERR_SSL_SSL_TLS_ALERT_HANDSHAKE_FAILURE)',
      ),
    ).toBe(
      'TLS handshake failed: SSL routines:ssl3_read_bytes:ssl/tls alert handshake failure:SSL alert number 40 (ERR_SSL_SSL_TLS_ALERT_HANDSHAKE_FAILURE)',
    );
  });

  it('leaves a plain cause alone', () => {
    expect(
      publicPageError('Connection failed: other side closed (UND_ERR_SOCKET)'),
    ).toBe('Connection failed: other side closed (UND_ERR_SOCKET)');
  });
});

describe('classifyRenderReason', () => {
  it('names the browser load budget as a timeout', () => {
    expect(
      classifyRenderReason(
        'page.goto: Timeout 20000ms exceeded.\nCall log:\n  - navigating to "https://x/"',
      ),
    ).toEqual({
      kind: 'timeout',
      message: 'The browser could not load the page within 20 seconds',
    });
  });

  it('keeps any other reason as a one-line render failure', () => {
    expect(classifyRenderReason('blocked host\nsecond line')).toEqual({
      kind: 'render_failed',
      message: 'blocked host',
    });
  });
});
