import { ConvexError } from 'convex/values';

import type { QueryCtx } from '../_generated/server';

// The real agent catalog/installation system (install/enable/
// uninstall mutations, the `agentInstallations` catalog queries) was retired
// wholesale with the chat/agents domain. `assertAgentAssigneeLive` is the one
// export `tasks/mutations.ts` and `tasks/internal_mutations.ts` need (task
// CRUD must keep working for HUMAN assignees).
//
// The `agentInstallations` table itself still exists (`convex/legacy/schema.ts`,
// kept so pre-rewrite rows aren't orphaned), but even a row with `enabled:
// true` from before the rewrite names an agent that can no longer actually
// run anything — the run-dispatch pipeline is offline too. Assigning a task
// to it would look like a normal assignment and then silently never be
// picked up, which is worse than an upfront rejection. So this always throws
// for an agent assignee (reusing the SAME `AGENT_NOT_LIVE` code/shape the
// real check used for "not installed or disabled" — true today for every
// agent, not just literally-uninstalled ones) while human assignment passes
// through untouched.

/**
 * Always rejects an agent assignee (see file header);
 * still a no-op for `null`/human assignees so task CRUD keeps working.
 */
export async function assertAgentAssigneeLive(
  _ctx: QueryCtx,
  _organizationId: string,
  assignee: { assigneeType: 'user' | 'agent'; assigneeId: string } | null,
): Promise<void> {
  if (!assignee || assignee.assigneeType !== 'agent') return;
  throw new ConvexError({
    code: 'AGENT_NOT_LIVE',
    message: `Agent "${assignee.assigneeId}" is offline while the platform AI backend is rewritten.`,
  });
}
