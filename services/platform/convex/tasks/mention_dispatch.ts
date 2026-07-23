/**
 * Direct agent-mention dispatch for TASK DESCRIPTIONS — the task-domain
 * sibling of `discussions/mention_dispatch.ts` (#2637 closed this class of
 * gap for discussions; this closes it for tasks).
 *
 * The PRIMARY route is event-driven: every task write that @mentions an
 * agent in its description emits `task.mentioned`, and the auto-installed
 * `react-to-task-mention` pack turns it into a `run_on_task` run (see
 * `builtin-configs/workflows/projects/tasks/react-to-task-mention.json`).
 * That chain only exists once the org's workflow provisioner has run — a
 * fresh org, or any deployment whose catalog lacks the pack, would otherwise
 * drop the mention forever, since events are never replayed.
 *
 * So the write paths call `dispatchAgentTaskMentionRuns` AFTER emitting the
 * event: when no `task.mentioned` subscription would fire (the shared
 * `hasLiveEventAutomation` check — mirrors `processEvent`'s admission: an
 * active subscription whose workflow is installed), the mention schedules
 * `runAgentOnTask` directly with a `mention` trigger — the SAME admission
 * gate (install/enable, budget, per-task circuit breaker) `runAgentOnTask`
 * applies on both routes. When the pack (or any org automation) is live, it
 * stays the single owner — no double replies.
 */

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { hasLiveEventAutomation } from '../discussions/mention_dispatch';
import type { ResolvedMention } from './mentions';

// `internal.agents.run_agent_on_task.runAgentOnTask`
// (`convex/agents/run_agent_on_task.ts`) moved with the agents domain.
// `hasLiveEventAutomation`'s read logic below is kept faithfully (pure
// `wfEventSubscriptions`/`wfInstallations` table reads, both still live
// tables, no AI dependency) — only the direct-dispatch fallback becomes a
// warn no-op.

export const TASK_MENTION_EVENT = 'task.mentioned';

/** Same brief the pack's `respond` step sends — one voice on both routes. */
export const TASK_MENTION_INSTRUCTIONS =
  'You were @-mentioned on this task — in the task description (the mentioning text is in the trigger context below). Read it, do what it asks of you using your task tools, and post your reply as a task comment. If it asks something outside your abilities, reply with a comment saying so precisely. If the request conflicts with your working agreement, decline politely in a comment.';

/**
 * Schedule a `runAgentOnTask` run (`trigger: 'mention'`) per @mentioned agent
 * when no event-driven automation will (see module header). Returns the
 * number of runs scheduled. Guards mirror the pack's steps: workflow-actor
 * writes are inert (loop-safety invariant iii — an engine-authored write must
 * never re-trigger the engine), and an agent never triggers itself. Run
 * admission (install/enable gate, budget, per-task circuit breaker) stays
 * inside `runAgentOnTask` — identical on both routes.
 */
export async function dispatchAgentTaskMentionRuns(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    taskId: Id<'tasks'>;
    description: string | undefined;
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
  if (
    await hasLiveEventAutomation(ctx, args.organizationId, TASK_MENTION_EVENT)
  ) {
    return 0;
  }

  // Offline — see file header. Reports 0 dispatched
  // (honest: nothing was actually scheduled) rather than the mention count.
  console.warn(
    `[dispatchAgentTaskMentionRuns] Agent-run dispatch is offline while the platform AI backend is rewritten; not running ${agentMentions.length} agent mention(s) for task ${args.taskId}`,
  );
  return 0;
}
