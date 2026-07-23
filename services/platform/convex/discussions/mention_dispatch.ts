/**
 * Direct agent-mention dispatch for discussions — the core-product fallback
 * behind the composer promise "@mention an agent to ask it to respond."
 *
 * The PRIMARY route is event-driven: every discussion post that @mentions an
 * agent emits `discussion.mentioned`, and the auto-installed
 * `react-to-discussion-mention` pack turns it into a `run_on_discussion` run
 * (see `configs/platform/custom/automations/projects/discussions/`). That chain only
 * exists once the org's workflow provisioner has run — a fresh org's SEEDED
 * starter discussion (posted seconds after org creation) and any deployment
 * whose catalog lacks the pack would otherwise drop the mention forever, since
 * events are never replayed (#2637).
 *
 * So the write paths call `dispatchAgentMentionRuns` AFTER emitting the event:
 * when no `discussion.mentioned` subscription would fire (mirrors
 * `processEvent`'s admission: an active subscription whose workflow is
 * installed), the mention schedules `runAgentOnDiscussion` directly, with the
 * same guards the pack applies (agent mentions only, never self, and
 * workflow-actor writes are inert). When the pack (or any org automation) is
 * live, it stays the single owner — no double replies.
 */

import type { MutationCtx } from '../_generated/server';
import type { ResolvedMention } from '../tasks/mentions';

// `internal.agents.run_agent_on_discussion.runAgentOnDiscussion`
// (`convex/agents/run_agent_on_discussion.ts`) moved with the agents domain.
// `hasLiveEventAutomation`'s read logic below is kept faithfully (pure
// `wfEventSubscriptions`/`wfInstallations` table reads, both still live
// tables, no AI dependency) — only the direct-dispatch fallback becomes a
// warn no-op.

export const DISCUSSION_MENTION_EVENT = 'discussion.mentioned';

/** Same brief the pack's `respond` step sends — one voice on both routes. */
export const DISCUSSION_MENTION_INSTRUCTIONS =
  'You were @-mentioned in this project discussion. Read it and post a helpful reply in your area of responsibility. If it is outside your remit, say so briefly and @-mention the teammate who should weigh in. If you cannot help, say so precisely.';

/**
 * Would `processEvent` start any workflow for `eventType` in this org? Mirrors
 * its admission exactly: an ACTIVE subscription whose workflow has a
 * `wfInstallations` row. (Subscription `eventFilter`s are ignored — a
 * filtered subscription still marks the org as automation-owned, keeping this
 * gate conservative: never a double reply.)
 *
 * Shared by every domain's direct-dispatch fallback, not just discussions —
 * see `dispatchAgentTaskMentionRuns` (`convex/tasks/mention_dispatch.ts`,
 * #2637's sibling gap for task `@mentions`) for the other caller. Lives here
 * because this module shipped first; extract further only if a third caller
 * needs it and the shared home starts to matter.
 */
export async function hasLiveEventAutomation(
  ctx: MutationCtx,
  organizationId: string,
  eventType: string,
): Promise<boolean> {
  for await (const sub of ctx.db
    .query('wfEventSubscriptions')
    .withIndex('by_org_eventType', (q) =>
      q.eq('organizationId', organizationId).eq('eventType', eventType),
    )) {
    const workflowSlug = sub.workflowSlug;
    if (!sub.isActive || !workflowSlug) continue;
    const installation = await ctx.db
      .query('wfInstallations')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', organizationId).eq('workflowSlug', workflowSlug),
      )
      .first();
    if (installation) return true;
  }
  return false;
}

/** `hasLiveEventAutomation` scoped to {@link DISCUSSION_MENTION_EVENT}. */
export async function hasLiveDiscussionMentionAutomation(
  ctx: MutationCtx,
  organizationId: string,
): Promise<boolean> {
  return hasLiveEventAutomation(ctx, organizationId, DISCUSSION_MENTION_EVENT);
}

/**
 * Schedule a `runAgentOnDiscussion` run per @mentioned agent when no
 * event-driven automation will (see module header). Returns the number of
 * runs scheduled. Guards mirror the pack's steps: workflow-actor writes are
 * inert (`not_workflow`), and an agent never triggers itself (`is_agent`).
 * Run admission (install/enable gate, budget, loop depth) stays inside
 * `runAgentOnDiscussion` — identical on both routes.
 */
export async function dispatchAgentMentionRuns(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    threadId: string;
    mentions: ResolvedMention[];
    actorType: 'user' | 'agent' | 'workflow';
    actorId: string;
  },
): Promise<number> {
  if (args.actorType === 'workflow') return 0;
  const agentMentions = args.mentions.filter(
    (m) => m.type === 'agent' && m.id !== args.actorId,
  );
  if (agentMentions.length === 0) return 0;
  if (await hasLiveDiscussionMentionAutomation(ctx, args.organizationId)) {
    return 0;
  }

  // Offline — see file header. Reports 0 dispatched
  // (honest: nothing was actually scheduled) rather than the mention count.
  console.warn(
    `[dispatchAgentMentionRuns] Agent-run dispatch is offline while the platform AI backend is rewritten; not running ${agentMentions.length} agent mention(s) for thread ${args.threadId}`,
  );
  return 0;
}
