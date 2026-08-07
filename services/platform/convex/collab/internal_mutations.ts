/**
 * Automation-facing notification fan-out — the write path behind the
 * workflow `notification` action (task-ops pack: SLA warnings, review
 * reminders, digests, unblock pings).
 *
 * Differences from the transactional emitters in `notify.ts` /
 * `notify_task_reviews.ts`:
 *  - the AUDIENCE is declarative (`task_assignee`, `task_creator`,
 *    `task_subscribers`, `project_creator`, `org_admins`, explicit `user_ids`)
 *    and resolved here;
 *  - every type respects the tri-state preference gate via `isAllowed`,
 *    EXCEPT `task_review_requested`/`task_review_resolved`: the `taskReview`
 *    toggle is locked always-on in the settings UI (safety signal, #2651),
 *    so `isAllowed` never honors a stored `taskReview` value — automation
 *    review reminders/resolutions can't be muted any more than the original
 *    transactional review request can. Every other type is muteable;
 *  - repeated cron firings are DEDUPED: an unread notification with the same
 *    (user, type, titleKey, resource) inside the dedupe window suppresses a
 *    re-send.
 */

import { v } from 'convex/values';

import { getString } from '../../lib/utils/type-utils';
import { components } from '../_generated/api';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { jsonRecordValidator } from '../lib/validators/json';
import { isAllowed, taskSubscriberUserIds } from './notify';
import { queueActionableEmail } from './notify_email';
import { notificationTypeValidator } from './schema';

const DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000;
const MEMBER_PAGE_SIZE = 100;
const MAX_RECIPIENTS = 500;
const ADMIN_ROLES = new Set(['owner', 'admin']);
const MEMBER_ROLES = new Set([
  'owner',
  'admin',
  'developer',
  'editor',
  'member',
]);

const audienceValidator = v.union(
  v.literal('user_ids'),
  v.literal('task_assignee'),
  v.literal('task_creator'),
  v.literal('task_subscribers'),
  v.literal('project_creator'),
  v.literal('org_admins'),
  v.literal('org_members'),
  v.literal('conversation_assignee'),
);

async function orgAdminUserIds(
  ctx: MutationCtx,
  organizationId: string,
): Promise<string[]> {
  return orgMemberUserIds(ctx, organizationId, ADMIN_ROLES);
}

async function orgMemberUserIds(
  ctx: MutationCtx,
  organizationId: string,
  roles: Set<string> = MEMBER_ROLES,
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;

  while (ids.length < MAX_RECIPIENTS) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter findMany returns paginated unknown
    const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: {
        cursor,
        numItems: Math.min(MEMBER_PAGE_SIZE, MAX_RECIPIENTS - ids.length),
      },
      where: [
        { field: 'organizationId', value: organizationId, operator: 'eq' },
      ],
    })) as {
      page?: Array<Record<string, unknown>>;
      isDone?: boolean;
      continueCursor?: string | null;
    };
    const page = result.page;
    for (const member of page ?? []) {
      const role = getString(member, 'role');
      const userId = getString(member, 'userId');
      if (role && userId && roles.has(role)) ids.push(userId);
    }
    if (result.isDone === true || !result.continueCursor) break;
    cursor = result.continueCursor;
  }

  return ids;
}

/** Same-(type, titleKey, resource) unread row inside the window ⇒ duplicate. */
async function isDuplicate(
  ctx: MutationCtx,
  args: {
    userId: string;
    organizationId: string;
    type: string;
    titleKey: string;
    resourceId: string;
  },
): Promise<boolean> {
  const cutoff = Date.now() - DEDUPE_WINDOW_MS;
  const recent = await ctx.db
    .query('userNotifications')
    .withIndex('by_user_org_created', (q) =>
      q
        .eq('userId', args.userId)
        .eq('organizationId', args.organizationId)
        .gt('createdAt', cutoff),
    )
    .order('desc')
    .take(50);
  return recent.some(
    (n) =>
      !n.read &&
      n.type === args.type &&
      n.titleKey === args.titleKey &&
      n.resourceId === args.resourceId,
  );
}

export const notifyFromAutomation = internalMutation({
  args: {
    organizationId: v.string(),
    audience: audienceValidator,
    type: notificationTypeValidator,
    titleKey: v.string(),
    bodyKey: v.string(),
    params: v.optional(jsonRecordValidator),
    taskId: v.optional(v.id('tasks')),
    projectId: v.optional(v.id('projects')),
    conversationId: v.optional(v.id('conversations')),
    userIds: v.optional(v.array(v.string())),
  },
  returns: v.object({ notified: v.number() }),
  handler: async (ctx, args): Promise<{ notified: number }> => {
    // Resolve the task/project anchors (org-isolated; silently skip on
    // mismatch — automations may race deletes).
    const task = args.taskId ? await ctx.db.get(args.taskId) : null;
    if (task && task.organizationId !== args.organizationId) {
      return { notified: 0 };
    }
    const projectId = args.projectId ?? task?.projectId;
    const project = projectId ? await ctx.db.get(projectId) : null;
    if (project && project.organizationId !== args.organizationId) {
      return { notified: 0 };
    }
    const conversation = args.conversationId
      ? await ctx.db.get(args.conversationId)
      : null;
    if (conversation && conversation.organizationId !== args.organizationId) {
      return { notified: 0 };
    }

    let recipients: string[] = [];
    switch (args.audience) {
      case 'user_ids':
        recipients = (args.userIds ?? []).filter(Boolean);
        break;
      case 'task_assignee':
        if (task?.assigneeType === 'user' && task.assigneeId) {
          recipients = [task.assigneeId];
        }
        break;
      case 'task_creator':
        if (task?.createdByType === 'user' && task.createdBy) {
          recipients = [task.createdBy];
        }
        break;
      case 'conversation_assignee':
        // Human owner only (schema stores a Better Auth userId). Unassigned ⇒
        // no recipients here; the workflow routes the admin fallback instead.
        if (conversation?.assigneeUserId) {
          recipients = [conversation.assigneeUserId];
        }
        break;
      case 'task_subscribers':
        if (args.taskId) {
          recipients = await taskSubscriberUserIds(ctx, args.taskId);
        }
        break;
      case 'project_creator':
        // `projects.createdBy` may hold an agent slug for agent-created
        // projects; a notification row keyed to a non-user id is inert
        // (never fetched), so no membership check is needed here.
        if (project?.createdBy) {
          recipients = [project.createdBy];
        }
        break;
      case 'org_admins':
        recipients = await orgAdminUserIds(ctx, args.organizationId);
        break;
      case 'org_members':
        recipients = await orgMemberUserIds(ctx, args.organizationId);
        break;
      default: {
        const unhandled: never = args.audience;
        throw new Error(`Unsupported audience: ${JSON.stringify(unhandled)}`);
      }
    }

    const unique = [...new Set(recipients)].slice(0, MAX_RECIPIENTS);
    const resourceType = args.taskId
      ? 'task'
      : args.conversationId
        ? 'conversation'
        : 'dashboard';
    const resourceId: string =
      args.taskId ??
      args.conversationId ??
      args.projectId ??
      args.organizationId;

    const notificationParams = {
      ...args.params,
      ...(args.conversationId
        ? {
            conversationId: String(args.conversationId),
            ...(conversation?.status
              ? { conversationStatus: conversation.status }
              : {}),
          }
        : {}),
    };

    let notified = 0;
    const now = Date.now();
    for (const userId of unique) {
      if (!(await isAllowed(ctx, userId, args.organizationId, args.type))) {
        continue;
      }
      if (
        await isDuplicate(ctx, {
          userId,
          organizationId: args.organizationId,
          type: args.type,
          titleKey: args.titleKey,
          resourceId,
        })
      ) {
        continue;
      }
      await ctx.db.insert('userNotifications', {
        userId,
        organizationId: args.organizationId,
        type: args.type,
        titleKey: args.titleKey,
        bodyKey: args.bodyKey,
        params: notificationParams,
        resourceType,
        resourceId,
        taskId: args.taskId ?? (task ? task._id : undefined),
        actorType: 'system',
        read: false,
        createdAt: now,
      });
      await queueActionableEmail(ctx, {
        userId,
        organizationId: args.organizationId,
        type: args.type,
        titleKey: args.titleKey,
        bodyKey: args.bodyKey,
        params: notificationParams,
        resourceType,
        resourceId,
        taskId: args.taskId ?? (task ? task._id : undefined),
      });
      notified += 1;
    }
    return { notified };
  },
});
