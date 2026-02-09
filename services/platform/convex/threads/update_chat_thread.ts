import { components } from '../_generated/api';
import { MutationCtx } from '../_generated/server';

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
