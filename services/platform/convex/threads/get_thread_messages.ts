/**
 * Get messages for a thread using Agent Component's listMessages.
 * This returns messages formatted for UI display.
 *
 * Uses listMessages with excludeToolMessages: true to filter out tool messages
 * and paginates through ALL messages (not just the first 100) to support
 * threads with more than 100 messages.
 */

import { QueryCtx } from '../_generated/server';
import { components } from '../_generated/api';
import { listMessages, toUIMessages, type MessageDoc } from '@convex-dev/agent';

export interface ThreadMessage {
  _id: string;
  _creationTime: number;
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
  // Note: Messages are returned in desc order, we need to reverse for chronological display
  const uiMessages = toUIMessages(allMessages.reverse());

  // Transform to our expected format
  // UIMessage has: key, text, _creationTime, role, parts, etc.
  const messages = uiMessages
    .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
    .map((msg) => ({
      _id: msg.id, // Use underlying message document id for linking
      _creationTime: msg._creationTime,
      role: msg.role as 'user' | 'assistant',
      content: msg.text,
    }));

  return { messages };
}
