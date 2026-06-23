/**
 * Read a parent thread's delegate sub-thread IDs from its summary.
 *
 * When a chat agent delegates (or escalates, or the router orchestrates) work,
 * the delegate runs in its OWN sub-thread, recorded in the parent thread's
 * summary as `{ subThreads: { [agentSlug]: subThreadId } }` (see
 * `get_or_create_sub_thread.ts`). Any `file_write` / `update_todos` the delegate
 * makes lands on that sub-thread, not the parent — so the parent's Canvas /
 * Plan panes, which query the route thread, never see delegated artifacts.
 *
 * The pane queries use this to union the parent thread with its delegate
 * sub-threads. Authorization is enforced ONCE on the parent thread by the
 * caller (`canAccessThread`); sub-threads have no `threadMetadata` row of their
 * own (they live only in the Agent SDK's thread table), so they cannot be
 * re-authorized — instead the caller org-filters the child rows it reads as
 * defense-in-depth. The `subThreads` map is owner-derived internal state, so
 * trusting it after the parent passes auth is sound.
 *
 * Returns `[]` for a normal thread (no delegation), an unparseable summary, or
 * a missing thread — callers treat that as "no sub-threads to union".
 */

import { parseJson } from '../../lib/utils/type-utils';
import { components } from '../_generated/api';
import type { ActionCtx, QueryCtx } from '../_generated/server';
import type { ThreadSummaryWithSubThreads } from '../agent_tools/sub_agents/helpers/types';

export async function getDelegateSubThreadIds(
  ctx: QueryCtx | ActionCtx,
  parentThreadId: string,
): Promise<string[]> {
  const thread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId: parentThreadId,
  });
  if (!thread?.summary) return [];

  let summary: ThreadSummaryWithSubThreads;
  try {
    summary = parseJson<ThreadSummaryWithSubThreads>(thread.summary);
  } catch {
    // A parent thread mid-compaction can briefly hold a non-JSON summary; treat
    // it as "no sub-threads" rather than failing the whole pane query.
    return [];
  }

  const map = summary.subThreads;
  if (!map) return [];

  // Dedupe defensively — the same sub-thread id should never appear under two
  // keys, but a future re-key bug shouldn't double-count its files.
  return Array.from(new Set(Object.values(map)));
}
