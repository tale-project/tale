import { createThread } from '@convex-dev/agent';

import type { ChatType } from './types';

import { components } from '../_generated/api';
import { MutationCtx } from '../_generated/server';

export async function createChatThread(
  ctx: MutationCtx,
  userId: string,
  title?: string,
  chatType: ChatType = 'general',
): Promise<string> {
  const summary = JSON.stringify({ chatType });
  const resolvedTitle = title ?? 'New Chat';
  const now = Date.now();

  const threadId = await createThread(ctx, components.agent, {
    userId,
    title: resolvedTitle,
    summary,
  });

  await ctx.db.insert('threadMetadata', {
    threadId,
    userId,
    chatType,
    status: 'active',
    title: resolvedTitle,
    createdAt: now,
  });

  return threadId;
}
