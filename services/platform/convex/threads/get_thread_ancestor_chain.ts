/**
 * Resolve the chain of thread IDs an agent in `threadId` should have read
 * access to: the thread itself plus every ancestor thread in the
 * delegation chain.
 *
 * Used by the RAG access gate so a sub-agent can read attachments uploaded
 * to the parent chat (the user's mental model: forking / delegating
 * doesn't lose access to what was already shared in the conversation).
 *
 * Walks the agent component's per-thread `summary.parentThreadId`. Branches
 * (`threadBranches`) are not walked here — branches share the parent
 * conversation surface and naturally inherit by virtue of carrying forward
 * messages. Only delegation/sub-thread chains need explicit traversal.
 *
 * Bounded by `MAX_THREAD_ANCESTOR_DEPTH` + a `visited` set to defeat
 * malformed cycles. Pure read; no side effects.
 */
import type { ActionCtx } from '../_generated/server';
import { getParentThreadId } from './get_parent_thread_id';

const MAX_THREAD_ANCESTOR_DEPTH = 32;

export async function getThreadAncestorChain(
  ctx: ActionCtx,
  threadId: string,
): Promise<string[]> {
  const chain: string[] = [threadId];
  const visited = new Set<string>([threadId]);
  let cursor: string | null = threadId;

  for (let depth = 0; depth < MAX_THREAD_ANCESTOR_DEPTH; depth++) {
    const parent = await getParentThreadId(ctx, cursor);
    if (!parent || visited.has(parent)) break;
    chain.push(parent);
    visited.add(parent);
    cursor = parent;
  }

  return chain;
}
