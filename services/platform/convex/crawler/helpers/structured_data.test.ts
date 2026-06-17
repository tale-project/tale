import { describe, expect, it } from 'vitest';

import {
  extractStructuredDataFromHtml,
  extractTitleFromHtml,
} from './structured_data';

describe('extractStructuredDataFromHtml', () => {
  it('extracts OpenGraph tags with the og: prefix stripped', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="My Page" />
        <meta property="og:description" content="A description" />
      </head></html>`;
    const result = extractStructuredDataFromHtml(html);
    expect(result.opengraph).toEqual({
      title: 'My Page',
      description: 'A description',
    });
  });

  it('ignores non-og property meta tags', () => {
    const html = `<meta property="fb:app_id" content="123" />`;
    expect(extractStructuredDataFromHtml(html).opengraph).toBeUndefined();
  });

  it('parses JSON-LD blocks', () => {
    const html = `
      <script type="application/ld+json">
        {"@type": "Organization", "name": "Acme"}
      </script>`;
    const result = extractStructuredDataFromHtml(html);
    expect(result.json_ld).toEqual([{ '@type': 'Organization', name: 'Acme' }]);
  });

  it('skips malformed JSON-LD without throwing', () => {
    const html = `<script type="application/ld+json">{ not valid json }</script>`;
    const result = extractStructuredDataFromHtml(html);
    expect(result.json_ld).toBeUndefined();
  });

  it('extracts common meta description/keywords/author', () => {
    const html = `
      <meta name="description" content="Page desc" />
      <meta name="keywords" content="a, b, c" />
      <meta name="author" content="Jane" />`;
    const result = extractStructuredDataFromHtml(html);
    expect(result.meta).toEqual({
      description: 'Page desc',
      keywords: 'a, b, c',
      author: 'Jane',
    });
  });

  it('returns an empty object for plain HTML', () => {
    expect(
      extractStructuredDataFromHtml('<html><body>Hi</body></html>'),
    ).toEqual({});
  });

  it('omits empty-content meta tags', () => {
    const html = `<meta property="og:title" content="" />`;
    expect(extractStructuredDataFromHtml(html).opengraph).toBeUndefined();
  });
});

describe('extractTitleFromHtml', () => {
  it('extracts and trims the document title', () => {
    expect(
      extractTitleFromHtml(
        '<html><head><title>  Hello  </title></head></html>',
      ),
    ).toBe('Hello');
  });

  it('returns null when there is no title', () => {
    expect(
      extractTitleFromHtml('<html><body>No title</body></html>'),
    ).toBeNull();
  });

  it('returns null for an empty title', () => {
    expect(extractTitleFromHtml('<title>   </title>')).toBeNull();
  });
});
