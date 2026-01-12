/**
 * Get messages for a thread with streaming support.
 *
 * Uses listUIMessages and syncStreams to support real-time streaming updates.
 * This enables the UI to show tool calls and text as they happen.
 */

import { QueryCtx } from '../../_generated/server';
import { components } from '../../_generated/api';
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
  // Fetch paginated UI messages
  const paginated = await listUIMessages(ctx, components.agent, {
    threadId: args.threadId,
    paginationOpts: args.paginationOpts,
  });

  // Fetch streaming deltas for real-time updates
  // Pass args directly as syncStreams expects { threadId, streamArgs, ... }
  // Only include 'streaming' status - finished messages come from listUIMessages
  // Including 'finished' here causes duplicates when both sources return the same message
  // Issue #184: Duplicate AI responses with paginated messages
  const streams = await syncStreams(ctx, components.agent, {
    ...args,
    includeStatuses: ['streaming'],
  });

  return {
    ...paginated,
    streams,
  };
}
