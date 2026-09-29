/**
 * How many conversations one bulk status request names at most. The bulk
 * door (`POST /api/app/conversations/bulk/:verb`) refuses a longer list, and
 * the Inbox sends a larger selection as consecutive requests of at most this
 * many — one number, so the selection and the door cannot disagree again.
 * `lib/` never imports `backend/`, hence the home here.
 */
export const BULK_CONVERSATION_LIMIT = 200;

/** `ids` in consecutive batches the bulk door takes, in their order. */
export function bulkConversationBatches<T>(ids: readonly T[]): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < ids.length; start += BULK_CONVERSATION_LIMIT) {
    batches.push(ids.slice(start, start + BULK_CONVERSATION_LIMIT));
  }
  return batches;
}
