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

import { QueryCtx } from '../_generated/server';
import { components } from '../_generated/api';
import {
  listUIMessages,
  syncStreams,
  type StreamArgs,
  type UIMessage,
} from '@convex-dev/agent';
import type { PaginationOptions } from 'convex/server';

export interface StreamingMessagesResult {
  page: UIMessage[];
  isDone: boolean;
  continueCursor: string;
  streams: Awaited<ReturnType<typeof syncStreams>>;
}

export async function getThreadMessagesStreaming(
  ctx: QueryCtx,
  args: {
    threadId: string;
    paginationOpts: PaginationOptions;
    streamArgs: StreamArgs | undefined;
  },
): Promise<StreamingMessagesResult> {
  // Fetch messages and streams concurrently for better performance.
  // - listUIMessages: handles MessageDoc -> UIMessage conversion with proper grouping
  //   (Note: numItems refers to MessageDocs, not UIMessages, so we may get fewer UIMessages)
  // - syncStreams: fetches streaming deltas for real-time updates
  //
  // Only include 'streaming' status - NOT 'finished'. Including 'finished' causes
  // duplicate messages because:
  // - listUIMessages returns merged UIMessage with stepOrder from first MessageDoc
  // - syncStreams returns stream with stepOrder from the stream metadata
  // - dedupeMessages uses (order, stepOrder) to detect duplicates
  // - Different stepOrder values = both are kept = duplicate display
  //
  // The SDK's useUIMessages already handles the streaming->finished transition:
  // stream data is preserved in frontend state until listUIMessages returns the
  // persisted version, then dedupeMessages replaces streaming with success status.
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
