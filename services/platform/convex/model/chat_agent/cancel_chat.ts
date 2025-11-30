/**
 * Model helper for canceling a chat run via ActionRetrier.
 */

import type { MutationCtx } from '../../_generated/server';
import type { RunId } from '@convex-dev/action-retrier';
import { chatAgentRetrier } from '../../lib/chat_agent_retrier';

export interface CancelChatArgs {
  // RunId is a branded string; on the wire we treat it as a plain string
  // and cast when calling the retrier.
  runId: string;
}

export async function cancelChat(
  ctx: MutationCtx,
  args: CancelChatArgs,
): Promise<null> {
  await chatAgentRetrier.cancel(ctx, args.runId as RunId);
  return null;
}
