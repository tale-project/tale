import { describe, expect, it } from 'vitest';

import {
  classifyContentType,
  documentNameForUrl,
  extractLinks,
  normalizeListedUrl,
  isDisallowed,
  isSitemapIndex,
  metaDescription,
  normalizeCandidateUrl,
  paragraphsForHashing,
  parseRobots,
  parseSitemapLocs,
  siteHosts,
  stripBoilerplate,
} from './crawl-parse';

/**
 * The crawler's judgment calls, pinned: which robots rules bind, which URLs
 * count as the same site, and which paragraphs the boilerplate ledger can
 * drop. Each of these is a decision the live web would only exercise
 * accidentally.
 */

describe('parseRobots', () => {
  it('honours only the wildcard agent group and collects sitemaps', () => {
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
    );
    expect(rules.disallow).toEqual(['/admin/', '/*.pdf']);
    expect(rules.sitemaps).toEqual([
      'https://example.com/sitemap.xml',
      'https://example.com/news-sitemap.xml',
    ]);
  });

  it('returns nothing for an empty or comment-only file', () => {
    expect(parseRobots('# nothing here\n')).toEqual({
      disallow: [],
      sitemaps: [],
    });
  });
});

describe('isDisallowed', () => {
  it('matches plain prefixes', () => {
    expect(isDisallowed('/admin/users', ['/admin/'])).toBe(true);
    expect(isDisallowed('/about', ['/admin/'])).toBe(false);
  });

  it('honours the * wildcard extension', () => {
    expect(isDisallowed('/files/report.pdf', ['/*.pdf'])).toBe(true);
    expect(isDisallowed('/files/report.html', ['/*.pdf'])).toBe(false);
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
});

describe('normalizeCandidateUrl', () => {
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
