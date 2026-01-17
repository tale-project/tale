/**
 * Update an example message
 */

import { MutationCtx } from '../_generated/server';
import { Id } from '../_generated/dataModel';

export async function updateExampleMessage(
  ctx: MutationCtx,
  args: {
    messageId: Id<'exampleMessages'>;
    content?: string;
    metadata?: unknown;
  },
): Promise<null> {
  const { messageId, ...updates } = args;

  const message = await ctx.db.get(messageId);
  if (!message) {
    throw new Error('Example message not found');
  }

  await ctx.db.patch(messageId, {
    ...updates,
    updatedAt: Date.now(),
  });

  return null;
}

