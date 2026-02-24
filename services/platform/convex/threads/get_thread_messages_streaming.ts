/**
 * Get messages for a thread with streaming support.
 *
 * Uses listMessages (with excludeToolMessages) and syncStreams to support
 * real-time streaming while keeping pagination efficient.
 *
 * Tool messages (tool-call + tool-result) are excluded from the paginated
 * query so that numItems maps more closely to visible UIMessages. Without
 * this, a single AI response with N tool calls creates N*2+2 MessageDocs,
 * which can push user messages out of the initial page.
 *
 * Streaming tool call UI is unaffected — syncStreams provides real-time
 * tool parts independently of the paginated results.
 */

import { listMessages, syncStreams, toUIMessages } from '@convex-dev/agent';

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
  const [messageResult, streams] = await Promise.all([
    listMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
      excludeToolMessages: true,
    }),
    syncStreams(ctx, components.agent, {
      ...args,
      includeStatuses: ['streaming'],
    }),
  ]);

  return {
    page: toUIMessages(messageResult.page),
    isDone: messageResult.isDone,
    continueCursor: messageResult.continueCursor,
    streams,
  };
}
