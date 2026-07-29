/**
 * Pure chat-health period helpers, kept out of the UI module so the route
 * loader can preload the metrics without importing the client page component.
 *
 * Bounded to 24h / 7d / 30d (no all-time): the metrics are byte-bounded
 * read-time scans over the heavy `messages` table, so windows stay short by
 * design — see `convex/chat/messages.ts:getOrgChatHealth`.
 */

import { z } from 'zod';

export type ChatHealthPeriod = '1' | '7' | '30';

export function periodToDays(p: ChatHealthPeriod): 1 | 7 | 30 {
  if (p === '1') return 1;
  if (p === '30') return 30;
  return 7;
}

/**
 * URL search schema for Settings → Metrics → Chat health. The router parses a
 * bare `?period=30` as the JSON number 30, which fails a plain string enum and
 * crashes the page via SearchParamError — coerce to a string first, then fall
 * back so a shared/bookmarked URL never renders the error boundary. Same bug
 * class as the feedback metrics search schema (issue #2034).
 */
export const chatHealthMetricsSearchSchema = z.object({
  period: z.coerce
    .string()
    .pipe(z.enum(['1', '7', '30']))
    .catch('7')
    .optional(),
});
