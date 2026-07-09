/**
 * Chronological ordering for conversation messages.
 *
 * Display timestamps come from `sentAt`, so sort keys must align with that
 * field first — not `deliveredAt`, which can be missing on outbound mail or
 * set later by the delivery checker.
 */

export interface ConversationMessageSortable {
  _id: string;
  _creationTime: number;
  sentAt?: number;
  deliveredAt?: number;
}

/** Primary sort timestamp: sentAt → deliveredAt → _creationTime. */
export function getConversationMessageSortTime(
  message: ConversationMessageSortable,
): number {
  return message.sentAt ?? message.deliveredAt ?? message._creationTime;
}

/** Ascending comparator for chronological thread display. */
export function compareConversationMessages(
  a: ConversationMessageSortable,
  b: ConversationMessageSortable,
): number {
  const timeDiff =
    getConversationMessageSortTime(a) - getConversationMessageSortTime(b);
  if (timeDiff !== 0) {
    return timeDiff;
  }
  return a._id.localeCompare(b._id);
}
