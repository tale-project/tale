import { createThread } from '@convex-dev/agent';

import { components } from '../_generated/api';
import { MutationCtx } from '../_generated/server';
import type { ChatType } from './types';

export async function createChatThread(
  ctx: MutationCtx,
  userId: string,
  title?: string,
  chatType: ChatType = 'general',
  arena?: {
    arenaGroupId: string;
    arenaModelId: string;
    isBranch?: boolean;
    forkedFrom?: string;
  },
): Promise<string> {
  const summary = JSON.stringify({ chatType });
  const resolvedTitle = title ?? 'New Chat';

  const threadId = await createThread(ctx, components.agent, {
    userId,
    title: resolvedTitle,
    summary,
  });

  const thread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId,
  });

  const createdAt = thread?._creationTime ?? Date.now();
  await ctx.db.insert('threadMetadata', {
    threadId,
    userId,
    chatType,
    status: 'active',
    title: resolvedTitle,
    createdAt,
    updatedAt: createdAt,
    ...(arena && {
      arenaGroupId: arena.arenaGroupId,
      arenaModelId: arena.arenaModelId,
      ...(arena.isBranch && { isBranch: true }),
      ...(arena.forkedFrom && { forkedFrom: arena.forkedFrom }),
    }),
  });

  return threadId;
}
