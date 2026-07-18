/**
 * Pure chat-health period helpers, kept out of the UI module so the route
 * loader can preload the rollup without importing the client page component.
 *
 * Bounded to 24h / 7d / 30d (no all-time): the rollup is a byte-bounded
 * read-time scan over heavy `messageMetadata` rows, so windows stay short by
 * design — see `convex/message_metadata/queries.ts:getChatHealthRollup`.
 */

export type ChatHealthPeriod = '1' | '7' | '30';

export function periodToDays(p: ChatHealthPeriod): 1 | 7 | 30 {
  if (p === '1') return 1;
  if (p === '30') return 30;
  return 7;
}
