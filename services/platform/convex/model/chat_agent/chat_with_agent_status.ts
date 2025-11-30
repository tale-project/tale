/**
 * Model helper for querying chat run status via ActionRetrier.
 */

import type { QueryCtx } from '../../_generated/server';
import type { RunId } from '@convex-dev/action-retrier';
import { chatAgentRetrier } from '../../lib/chat_agent_retrier';
import type { GenerateAgentResponseResult } from './generate_agent_response';

export interface ChatWithAgentStatusArgs {
  // runId is stored as a string on the client; cast back to RunId for retrier.
  runId: string;
}

export type ChatWithAgentStatusResult =
  | { status: 'inProgress' }
  | { status: 'success'; result: GenerateAgentResponseResult }
  | { status: 'failed'; error: string }
  | { status: 'canceled' };

export async function chatWithAgentStatus(
  ctx: QueryCtx,
  args: ChatWithAgentStatusArgs,
): Promise<ChatWithAgentStatusResult> {
  const status = await chatAgentRetrier.status(ctx, args.runId as RunId);

  if (status.type === 'inProgress') {
    return { status: 'inProgress' };
  }

  // completed -> inspect RunResult
  const result = status.result;

  if (result.type === 'success') {
    const chatResult = result.returnValue as GenerateAgentResponseResult;
    return {
      status: 'success',
      result: chatResult,
    };
  }

  if (result.type === 'failed') {
    return {
      status: 'failed',
      error: result.error,
    };
  }

  // canceled
  return { status: 'canceled' };
}
