/**
 * Get messages for a thread with streaming support.
 *
 * Uses listUIMessages and syncStreams to support real-time streaming.
 * This enables the UI to show tool calls and text as they happen.
 *
 * PAGINATION NOTE:
 * - listUIMessages paginates based on MessageDoc count, not UIMessage count
 * - A single AI response with N tool calls = N*2+2 MessageDocs but only 2 UIMessages
 * - This means `numItems` refers to MessageDocs, and the actual UIMessage count varies
 * - usePaginatedQuery in the frontend accumulates results across pages correctly
 * - IMPORTANT: Each conversation turn creates ~5 MessageDocs (user, system, tool-call,
 *   tool-result, assistant-text). Set initialNumItems high enough to avoid pagination
 *   cutting off messages mid-turn, which causes "tool result without preceding tool call"
 *   warnings and missing user messages.
 */

import { listUIMessages, syncStreams } from '@convex-dev/agent';

import type {
  GetThreadMessagesStreamingArgs,
  StreamingMessagesResult,
} from './types';

import { components } from '../_generated/api';
import { QueryCtx } from '../_generated/server';

export async function getThreadMessagesStreaming(
  ctx: QueryCtx,
  args: GetThreadMessagesStreamingArgs,
): Promise<StreamingMessagesResult> {
  // Only include 'streaming' status - NOT 'finished'. Including 'finished' causes
  // duplicate messages because listUIMessages and syncStreams use different stepOrder
  // values, so dedupeMessages treats them as distinct entries.
  const [result, streams] = await Promise.all([
    listUIMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    }),
    syncStreams(ctx, components.agent, {
      ...args,
      includeStatuses: ['streaming'],
    }),
  ]);

  return {
    page: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
    streams,
  };
}
