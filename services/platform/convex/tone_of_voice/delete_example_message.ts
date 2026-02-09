/**
 * Delete an example message
 */

import { Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';

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
