/**
 * Format available website summaries for display in no-results messages.
 *
 * Queries the organization's indexed websites and returns a formatted
 * bullet list, or undefined if no websites are configured.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { internal } from '../../../_generated/api';

const MAX_LISTED_WEBSITES = 15;

/**
 * Query and format website summaries for the given organization.
 * Returns a formatted string like:
 *   - docs.convex.dev — Convex documentation (245 pages)
 *   - example.com (18 pages)
 *
 * Returns undefined if no websites are configured.
 */
export async function formatWebsiteSummaries(
  ctx: ToolCtx,
  organizationId: string,
): Promise<string | undefined> {
  const websites = await ctx.runQuery(
    internal.websites.internal_queries.listWebsiteSummaries,
    { organizationId },
  );

  if (!websites || websites.length === 0) return undefined;

  const listed = websites.slice(0, MAX_LISTED_WEBSITES);
  const lines = listed.map((w) => {
    const parts = [w.domain];
    if (w.title || w.description) {
      parts.push(` — ${w.title ?? w.description}`);
    }
    if (w.pageCount != null) {
      parts.push(` (${w.pageCount} pages)`);
    }
    return `- ${parts.join('')}`;
  });

  if (websites.length > MAX_LISTED_WEBSITES) {
    lines.push(`- ... and ${websites.length - MAX_LISTED_WEBSITES} more`);
  }

  return lines.join('\n');
}
