import { MutationCtx } from '../_generated/server';
import { components } from '../_generated/api';

export async function updateChatThread(
  ctx: MutationCtx,
  threadId: string,
  title: string,
): Promise<void> {
  await ctx.runMutation(components.agent.threads.updateThread, {
    threadId,
    patch: { title },
  });
}
