import { MutationCtx } from '../_generated/server';
import { components } from '../_generated/api';
import { createThread } from '@convex-dev/agent';

export type ChatType = 'general' | 'workflow_assistant';

export async function createChatThread(
  ctx: MutationCtx,
  userId: string,
  title?: string,
  chatType: ChatType = 'general',
): Promise<string> {
  const summary = JSON.stringify({ chatType });

  return await createThread(ctx, components.agent, {
    userId,
    title: title ?? 'New Chat',
    summary,
  });
}
