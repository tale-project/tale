/**
 * Notification fan-out for the ask-a-human loop (`automations/human_asks.ts`).
 *
 * A run parked on an `ask_human` question is invisible urgency: the board
 * pulses "working", the task keeps its status, and an unanswered ask settles
 * the turn as errored after seven days — so the people who could answer must
 * be TOLD, not hoped onto the open task dialog. The audience is everyone who
 * can SEE the project the run works in (`getProjectAccessibleUserIds`), NOT
 * the task's subscribers: an automation-created task usually has no human
 * subscriber, which is exactly how asks went unseen. A run with no project
 * context falls back to the org admins.
 *
 * Rows reuse the `agent_escalation` type (the human-in-the-loop signal group:
 * actionable, emails, `escalation` preference) and collapse on the task's
 * `question` dimension (`coalesce.ts`) — a folded follow-up question rewrites
 * the unread row and re-debounces its email instead of stacking a second row.
 * `dismissAgentQuestionNotifications` marks the rows read the moment the ask
 * is answered, cancelled, or expired, cancelling a still-pending email so an
 * answer that beat the debounce sends nothing.
 */

import { isRecord } from '../../lib/utils/type-utils';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { ADMIN_ROLES } from '../projects/access';
import { getProjectAccessibleUserIds } from '../projects/accessible_members';
import { writeCoalescedNotification } from './coalesce';
import { isAllowed } from './notify';

/** Fan-out bound — matches the automation fan-out (`internal_mutations.ts`). */
const MAX_RECIPIENTS = 500;
/** Same member/unread scan bounds as `dismiss_review_notifications.ts`. */
const MEMBER_SCAN_CAP = 500;
const UNREAD_SCAN_CAP = 100;

/** Bell/email bodies quote the question inline — keep it one scannable line,
 * not the 8k the ask row may carry (the card shows the full text). */
const QUESTION_EXCERPT_MAX = 160;

export function questionExcerpt(question: string): string {
  const flat = question.replace(/\s+/g, ' ').trim();
  return flat.length <= QUESTION_EXCERPT_MAX
    ? flat
    : `${flat.slice(0, QUESTION_EXCERPT_MAX)}…`;
}

/** Every user who can see the project — org admins/owners ∪ the project's
 * team members, or all non-disabled members for an org-wide project. */
async function projectAudienceUserIds(
  ctx: MutationCtx,
  project: Doc<'projects'>,
): Promise<string[]> {
  const accessible = await getProjectAccessibleUserIds(ctx, project);
  if (accessible !== null) return [...accessible];
  const ids: string[] = [];
  for await (const member of ctx.db
    .query('memberMirror')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', project.organizationId),
    )) {
    if (member.role === 'disabled') continue;
    ids.push(member.userId);
    if (ids.length >= MAX_RECIPIENTS) break;
  }
  return ids;
}

/** Org admins/owners — the fallback audience for a run with no project. */
async function orgAdminUserIds(
  ctx: MutationCtx,
  organizationId: string,
): Promise<string[]> {
  const ids: string[] = [];
  for await (const member of ctx.db
    .query('memberMirror')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    )) {
    if (!ADMIN_ROLES.has(member.role)) continue;
    ids.push(member.userId);
    if (ids.length >= MAX_RECIPIENTS) break;
  }
  return ids;
}

/**
 * One actionable inbox row per person who can see the project: "the agent
 * paused with a question". Called on ask creation AND on a fold (the merged
 * question is the current truth — the collapse dimension rewrites the unread
 * row in place). Returns the number of rows written/rewritten.
 */
export async function notifyAgentQuestionAsked(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    askId: Id<'automationHumanAsks'>;
    runId: Id<'automationRuns'>;
    question: string;
    /** How the automation names itself to people (presentation name ?? slug). */
    automationLabel: string;
    task: Doc<'tasks'> | null;
    /** The run's own project, for asks with no task subject. */
    projectId?: Id<'projects'>;
  },
): Promise<number> {
  const projectId = args.task?.projectId ?? args.projectId;
  const project = projectId ? await ctx.db.get(projectId) : null;
  const recipients =
    project !== null && project.organizationId === args.organizationId
      ? await projectAudienceUserIds(ctx, project)
      : await orgAdminUserIds(ctx, args.organizationId);

  const unique = [...new Set(recipients)].slice(0, MAX_RECIPIENTS);
  const params: Record<string, unknown> = {
    name: args.automationLabel,
    question: questionExcerpt(args.question),
    askId: String(args.askId),
    runId: String(args.runId),
    ...(args.task
      ? { title: args.task.title, projectId: String(args.task.projectId) }
      : project
        ? { projectId: String(project._id) }
        : {}),
  };

  let notified = 0;
  for (const userId of unique) {
    if (
      !(await isAllowed(ctx, userId, args.organizationId, 'agent_escalation'))
    ) {
      continue;
    }
    await writeCoalescedNotification(ctx, {
      userId,
      organizationId: args.organizationId,
      type: 'agent_escalation',
      titleKey: 'agentQuestionAsked',
      bodyKey: args.task
        ? 'agentQuestionAskedBody'
        : 'agentQuestionAskedNoTaskBody',
      params,
      resourceType: args.task ? 'task' : 'dashboard',
      resourceId: args.task
        ? String(args.task._id)
        : (project?._id ?? args.organizationId),
      ...(args.task ? { taskId: args.task._id } : {}),
      actorType: 'agent',
      actorId: args.automationLabel,
    });
    notified += 1;
  }
  return notified;
}

/**
 * The ask is no longer pending (answered / cancelled / expired) — mark every
 * recipient's unread ask row read and cancel a still-pending email job, so
 * nobody is nudged toward a question that no longer takes an answer. Read
 * rows stay untouched (they are history). Returns the rows dismissed.
 */
export async function dismissAgentQuestionNotifications(
  ctx: MutationCtx,
  args: { organizationId: string; askId: Id<'automationHumanAsks'> },
): Promise<number> {
  const askIdStr = String(args.askId);
  const now = Date.now();
  let dismissed = 0;

  // Same shape (and scale note) as `dismiss_review_notifications.ts`:
  // `userNotifications` is keyed by user first, so clearing by ask means a
  // bounded per-member walk. Past the cap a stale bell simply lingers.
  const userIds: string[] = [];
  for await (const member of ctx.db
    .query('memberMirror')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )) {
    userIds.push(member.userId);
    if (userIds.length >= MEMBER_SCAN_CAP) break;
  }

  for (const userId of userIds) {
    const unread = await ctx.db
      .query('userNotifications')
      .withIndex('by_user_org_read', (q) =>
        q
          .eq('userId', userId)
          .eq('organizationId', args.organizationId)
          .eq('read', false),
      )
      .order('desc')
      .take(UNREAD_SCAN_CAP);
    for (const row of unread) {
      if (row.type !== 'agent_escalation') continue;
      if (!isRecord(row.params) || row.params.askId !== askIdStr) continue;
      if (row.emailJobId !== undefined) {
        // Cancelling an already-run job is a documented no-op.
        await ctx.scheduler.cancel(row.emailJobId);
      }
      await ctx.db.patch(row._id, { read: true, readAt: now });
      dismissed += 1;
    }
  }
  return dismissed;
}
