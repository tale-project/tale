import type { ChatThreadSummary } from '../types';

/** Activity timestamp used to pick the chat a user would resume into. */
function activityAt(thread: ChatThreadSummary): number {
  return thread.lastReplyAt ?? thread.createdAt;
}

/**
 * The caller's most recently active thread (by last reply, else creation).
 * Ignores pin order — pins float the list for browsing, not for resume.
 */
export function pickMostRecentThread(
  threads: readonly ChatThreadSummary[],
): ChatThreadSummary | undefined {
  let best: ChatThreadSummary | undefined;
  let bestAt = -1;
  for (const thread of threads) {
    const at = activityAt(thread);
    if (at > bestAt) {
      best = thread;
      bestAt = at;
    }
  }
  return best;
}
