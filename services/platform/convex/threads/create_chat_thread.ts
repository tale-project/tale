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

  return createThread(ctx, components.agent, {
    userId,
    title: title ?? 'New Chat',
    summary,
  });
}
