/**
 * Create a new chat thread using Convex Agent Component.
 */

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
  // Create thread using Agent Component
  // The thread is stored in Agent's threads table
  const summary = JSON.stringify({ chatType });

  const threadId = await createThread(ctx, components.agent, {
    userId: userId,
    title: title ?? 'New Chat',
    summary,
  });

  return threadId;
}
