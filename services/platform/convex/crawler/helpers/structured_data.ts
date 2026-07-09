'use node';

/**
 * Faithful port of `CrawlerService._extract_structured_data_from_html`
 * (services/crawler/app/services/crawler_service.py) using jsdom in place of
 * BeautifulSoup.
 *
 * Extracts, from a page's raw HTML:
 *   - opengraph: every `<meta property="og:*">` (key stripped of the `og:` prefix)
 *   - json_ld:   every `<script type="application/ld+json">` parsed as JSON
 *   - meta:      description / keywords / author `<meta name="...">` tags
 */

import { parseHtml } from './parse_html';

export interface StructuredData {
  opengraph?: Record<string, string>;
  json_ld?: unknown[];
  meta?: Record<string, string>;
}

export function extractStructuredDataFromHtml(html: string): StructuredData {
  const structured: StructuredData = {};
  try {
    const { document } = parseHtml(html).window;

    // OpenGraph.
    const ogData: Record<string, string> = {};
    for (const tag of Array.from(document.querySelectorAll('meta[property]'))) {
      const prop = tag.getAttribute('property') ?? '';
      if (!prop.startsWith('og:')) {
        continue;
      }
      const content = tag.getAttribute('content') ?? '';
      if (content) {
        ogData[prop.replace('og:', '')] = content;
      }
    }
    if (Object.keys(ogData).length > 0) {
      structured.opengraph = ogData;
    }

    // JSON-LD.
    const jsonLd: unknown[] = [];
    for (const script of Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    )) {
      const raw = script.textContent;
      if (!raw) {
        continue;
      }
      try {
        jsonLd.push(JSON.parse(raw));
      } catch {
        // Malformed JSON-LD is skipped (parity with the Python try/except).
      }
    }
    if (jsonLd.length > 0) {
      structured.json_ld = jsonLd;
    }

    // Common meta tags.
    const meta: Record<string, string> = {};
    for (const name of ['description', 'keywords', 'author']) {
      const tag = document.querySelector(`meta[name="${name}"]`);
      const content = tag?.getAttribute('content');
      if (content) {
        meta[name] = content;
      }
    }
    if (Object.keys(meta).length > 0) {
      structured.meta = meta;
    }
  } catch (err) {
    console.warn(
      `[crawler] Failed to extract structured data from HTML: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return structured;
}

/** Extract the document `<title>` from raw HTML. */
export function extractTitleFromHtml(html: string): string | null {
  try {
    const { document } = parseHtml(html).window;
    const title = document.querySelector('title')?.textContent?.trim();
    return title && title.length > 0 ? title : null;
  } catch {
    return null;
  }
}
