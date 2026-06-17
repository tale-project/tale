'use node';

/**
 * Cross-page paragraph deduplication for boilerplate filtering.
 *
 * Faithful port of `services/crawler/app/utils/paragraph_dedup.py`.
 *
 * Tracks paragraph fingerprints per page to identify content that appears
 * across many pages in a domain. Lines appearing on more than a threshold
 * number of pages are considered boilerplate and filtered before chunking.
 */

import { createHash } from 'node:crypto';

export const BOILERPLATE_PAGE_THRESHOLD = 5;
export const MIN_DOMAIN_PAGES_FOR_DEDUP = 5;
export const MIN_LINE_LENGTH = 10;

/**
 * MD5 hash of normalized, stripped paragraph text.
 *
 * Python: `unicodedata.normalize("NFC", text.strip())` then MD5 hex. JS
 * `String.prototype.normalize('NFC')` is the equivalent NFC normalizer; `.trim()`
 * matches Python's `.strip()` for the whitespace classes that occur in scraped
 * markdown. The MD5 is a content-dedup fingerprint, not a security hash.
 */
export function paragraphHash(text: string): string {
  const normalized = text.trim().normalize('NFC');
  return createHash('md5').update(normalized, 'utf-8').digest('hex');
}

/** Whether a line is long enough to be a meaningful fingerprint. */
function isHashableLine(line: string): boolean {
  return line.trim().length >= MIN_LINE_LENGTH;
}

/**
 * Extract unique line-level hashes from markdown content.
 *
 * Splits on single newlines for line-level granularity so that boilerplate
 * lines (cookie banners, nav, footers) are individually fingerprinted even when
 * the crawler emits single-newline-separated markdown. Lines shorter than
 * MIN_LINE_LENGTH are skipped. Deduplicates within a page so repeated lines
 * don't inflate cross-page frequency.
 */
export function extractParagraphHashes(content: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of content.trim().split('\n')) {
    const stripped = line.trim();
    if (!stripped || !isHashableLine(stripped)) {
      continue;
    }
    const h = paragraphHash(stripped);
    if (!seen.has(h)) {
      seen.add(h);
      result.push(h);
    }
  }
  return result;
}

/**
 * Remove lines that appear on too many pages.
 *
 * @param content Raw markdown page content.
 * @param pageCounts Mapping of paragraph_hash to number of pages it appears on.
 * @param threshold Lines appearing on more than this many pages are removed.
 *
 * Returns content with boilerplate lines removed. Lines shorter than
 * MIN_LINE_LENGTH are always kept (not enough signal to fingerprint). If
 * `pageCounts` is empty (domain too small), returns content unchanged.
 */
export function filterBoilerplateParagraphs(
  content: string,
  pageCounts: Record<string, number>,
  threshold: number = BOILERPLATE_PAGE_THRESHOLD,
): string {
  if (Object.keys(pageCounts).length === 0) {
    return content;
  }

  const lines = content.split('\n');
  const kept = lines.filter(
    (line) =>
      !isHashableLine(line) ||
      (pageCounts[paragraphHash(line.trim())] ?? 0) <= threshold,
  );
  return kept.join('\n');
}
