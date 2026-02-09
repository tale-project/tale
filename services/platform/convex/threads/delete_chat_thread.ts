import { components } from '../_generated/api';
import { MutationCtx } from '../_generated/server';

export async function deleteChatThread(
  ctx: MutationCtx,
  threadId: string,
): Promise<void> {
  await ctx.runMutation(components.agent.threads.updateThread, {
    threadId,
    patch: { status: 'archived' },
  });
}
