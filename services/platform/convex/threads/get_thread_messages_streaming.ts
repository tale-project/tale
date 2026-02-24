/**
 * Get messages for a thread with streaming support.
 *
 * Uses listUIMessages and syncStreams to support real-time streaming.
 *
 * IMPORTANT: Do NOT use `listMessages(excludeToolMessages: true) + toUIMessages`
 * here. Excluding tool messages changes the UIMessage's id (becomes text
 * MessageDoc id instead of tool-call MessageDoc id) and stepOrder, which breaks:
 * - dedupeMessages in useUIMessages (stream stepOrder ≠ paginated stepOrder → duplicates)
 * - message metadata lookup (metadata is stored against tool-call MessageDoc id)
 *
 * Pagination is based on MessageDoc count, not UIMessage count. A single AI
 * response with N tool calls = N*2+2 MessageDocs but only 2 UIMessages. The
 * client-side adaptive auto-load in useMessageProcessing compensates for this
 * by loading more when visible user messages are too few.
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
