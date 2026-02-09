/**
 * Update an example message
 */

import type { ConvexJsonRecord } from '../../lib/shared/schemas/utils/json-value';

import { Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';

export async function updateExampleMessage(
  ctx: MutationCtx,
  args: {
    messageId: Id<'exampleMessages'>;
    content?: string;
    metadata?: ConvexJsonRecord;
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
