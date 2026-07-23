/**
 * Get messages for a thread using Agent Component's listMessages.
 * This returns messages formatted for UI display.
 *
 * Uses listMessages with excludeToolMessages: true to filter out tool messages
 * and paginates through ALL messages (not just the first 100) to support
 * threads with more than 100 messages.
 *
 * A faithful restore of the original `threads/get_thread_messages.ts` —
 * despite having lived under the (wholesale-retired) `convex/threads/`
 * chat-pipeline directory, this specific helper has no AI-backend
 * dependency at all: it
 * only wraps `@convex-dev/agent`'s own `listMessages`/`toUIMessages` (a
 * still-installed, unrelated third-party message-store component). It is
 * the read side `tasks/internal_queries.ts`'s `readTaskDiscussionMessages`
 * (in turn read by the still-live, non-AI task/project discussion "comments"
 * UI in `tasks/queries.ts`) depends on — stubbing it to return `[]` would
 * have silently hidden every existing task comment, a real regression to a
 * feature with nothing to do with the rewrite.
 */

import { listMessages, toUIMessages, type MessageDoc } from '@convex-dev/agent';

import { components } from '../_generated/api';
import type { QueryCtx } from '../_generated/server';

export interface ThreadMessage {
  _id: string;
  _creationTime: number;
  order: number;
  role: 'user' | 'assistant';
  content: string;
}

export async function getThreadMessages(
  ctx: QueryCtx,
  threadId: string,
): Promise<{ messages: ThreadMessage[] }> {
  // Collect all messages using pagination
  // Use excludeToolMessages: true to filter out tool messages at the query level
  const allMessages: MessageDoc[] = [];

  let cursor: string | null = null;
  let isDone = false;
  const PAGE_SIZE = 100;

  // Paginate through all messages
  while (!isDone) {
    const result = await listMessages(ctx, components.agent, {
      threadId: threadId,
      paginationOpts: { cursor, numItems: PAGE_SIZE },
      excludeToolMessages: true, // Filter out tool messages
    });

    allMessages.push(...result.page);
    cursor = result.continueCursor;
    isDone = result.isDone;
  }

  // Convert to UI messages format using the agent component's helper
  // Note: Messages are returned in desc order, we need to reverse for
  // chronological display. `convex/tsconfig.json`'s `lib` doesn't include
  // ES2023, so a copy + in-place `.reverse()` stands in for `.toReversed()`.
  // oxlint-disable-next-line unicorn/no-array-reverse -- runtime lacks toReversed; the spread already copies
  const uiMessages = toUIMessages([...allMessages].reverse());

  // Transform to our expected format
  // UIMessage has: key, text, _creationTime, role, parts, etc.
  const messages = uiMessages
    .filter(
      (msg): msg is typeof msg & { role: 'user' | 'assistant' } =>
        msg.role === 'user' || msg.role === 'assistant',
    )
    .map((msg) => ({
      _id: msg.id,
      _creationTime: msg._creationTime,
      order: msg.order,
      role: msg.role,
      content: msg.text,
    }));

  return { messages };
}
