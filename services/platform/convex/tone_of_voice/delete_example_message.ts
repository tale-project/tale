/**
 * Delete an example message
 */

import { MutationCtx } from '../_generated/server';
import { Id } from '../_generated/dataModel';

export async function deleteExampleMessage(
  ctx: MutationCtx,
  args: { messageId: Id<'exampleMessages'> },
): Promise<null> {
  const message = await ctx.db.get(args.messageId);
  if (!message) {
    throw new Error('Example message not found');
  }

  await ctx.db.delete(args.messageId);
  return null;
}

