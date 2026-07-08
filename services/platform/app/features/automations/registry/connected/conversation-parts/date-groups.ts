import { groupMessagesByDate } from '@/lib/utils/conversation/date-utils';

/**
 * Generic, typed face over the shared `groupMessagesByDate` util: the util
 * only reads (and round-trips) each entry's `timestamp` field, but its
 * signature is pinned to the legacy conversations `Message` type — this
 * wrapper keeps the single grouping implementation while letting the
 * ConversationThread block group its own normalized bubble shape.
 */
export function groupByTimestamp<T extends { timestamp: string }>(
  items: T[],
): { date: string; items: T[] }[] {
  const groups = groupMessagesByDate(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- groupMessagesByDate reads only `timestamp` and returns the same objects; the legacy Message pin is nominal
    items as unknown as Parameters<typeof groupMessagesByDate>[0],
  );
  return groups.map((group) => ({
    date: group.date,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- identity-preserving grouping: these are the T objects passed in
    items: group.messages as unknown as T[],
  }));
}
