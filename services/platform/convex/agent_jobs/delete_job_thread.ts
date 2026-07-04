import { components } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';

/**
 * Delete a job's transcript thread (messages + streams) via the agent
 * component. Own module so the GC mutation stays convexTest-able — the
 * component is unavailable there and tests mock this seam.
 */
export async function deleteJobThread(
  ctx: MutationCtx,
  jobThreadId: string,
): Promise<void> {
  await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
    threadId: jobThreadId,
  });
}
