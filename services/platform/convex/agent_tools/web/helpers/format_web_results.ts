/**
 * Shared formatting for web search results.
 *
 * Each page's content is wrapped in <untrusted_source> so the LLM treats it
 * as data, not instructions (defense-in-depth against prompt injection from
 * crawled pages).
 */

import { wrapUntrusted } from '../../../lib/untrusted_content';

export interface WebSearchPage {
  title: string;
  url: string;
  score: number;
  content: string;
}

/**
 * Format web search pages into a numbered list with relevance scores.
 *
 * Example output:
 * ```
 * [1] (Relevance: 85.2%) [Source: Page Title] [URL: https://example.com]
 * <untrusted_source tool="web" url="https://example.com">
 * <content>
 * </untrusted_source>
 *
 * ---
 *
 * [2] (Relevance: 72.1%) [Source: Another Page] [URL: https://example.com/other]
 * <untrusted_source tool="web" url="https://example.com/other">
 * <content>
 * </untrusted_source>
 * ```
 *
 * Returns `undefined` when there are no pages.
 */
export function formatWebResults(pages: WebSearchPage[]): string | undefined {
  if (pages.length === 0) return undefined;

  return pages
    .map((page, idx) => {
      const score = (page.score * 100).toFixed(1);
      const wrapped = wrapUntrusted(page.content, {
        tool: 'web',
        url: page.url,
      });
      return `[${idx + 1}] (Relevance: ${score}%) [Source: ${page.title}] [URL: ${page.url}]\n${wrapped}`;
    })
    .join('\n\n---\n\n');
}
