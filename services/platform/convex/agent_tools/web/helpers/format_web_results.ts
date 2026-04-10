/**
 * Shared formatting for web search results.
 *
 * Used by search_pages (tool mode) and query_web_context (context injection)
 * to produce a consistent numbered-chunk format matching RAG output style.
 */

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
 * <content>
 *
 * ---
 *
 * [2] (Relevance: 72.1%) [Source: Another Page] [URL: https://example.com/other]
 * <content>
 * ```
 *
 * Returns `undefined` when there are no pages.
 */
export function formatWebResults(pages: WebSearchPage[]): string | undefined {
  if (pages.length === 0) return undefined;

  return pages
    .map((page, idx) => {
      const score = (page.score * 100).toFixed(1);
      return `[${idx + 1}] (Relevance: ${score}%) [Source: ${page.title}] [URL: ${page.url}]\n${page.content}`;
    })
    .join('\n\n---\n\n');
}
