/**
 * Automation-facing notification fan-out — the write path behind the
 * workflow `notification` action (task-ops pack: SLA warnings, review
 * reminders, digests, unblock pings).
 *
 * Differences from the transactional emitters in `notify.ts` /
 * `notify_workforce.ts`:
 *  - the AUDIENCE is declarative (`task_assignee`, `task_subscribers`,
 *    `project_creator`, `org_admins`, explicit `user_ids`) and resolved here;
 *  - every type respects the tri-state preference gate (automation noise is
 *    always muteable — the only pref-skipping notification is the original
 *    review request, which is transactional, not automation-driven);
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
const MAX_RECIPIENTS = 100;
const ADMIN_ROLES = new Set(['owner', 'admin']);

const audienceValidator = v.union(
  v.literal('user_ids'),
  v.literal('task_assignee'),
  v.literal('task_subscribers'),
  v.literal('project_creator'),
  v.literal('org_admins'),
);

async function orgAdminUserIds(
  ctx: MutationCtx,
  organizationId: string,
): Promise<string[]> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: { cursor: null, numItems: MAX_RECIPIENTS },
    where: [{ field: 'organizationId', value: organizationId, operator: 'eq' }],
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter findMany returns paginated unknown
  const page = (result as { page?: Array<Record<string, unknown>> })?.page;
  const ids: string[] = [];
  for (const member of page ?? []) {
    const role = getString(member, 'role');
    const userId = getString(member, 'userId');
    if (role && userId && ADMIN_ROLES.has(role)) ids.push(userId);
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
      default: {
        const unhandled: never = args.audience;
        throw new Error(`Unsupported audience: ${JSON.stringify(unhandled)}`);
      }
    }

    const unique = [...new Set(recipients)].slice(0, MAX_RECIPIENTS);
    const resourceType = args.taskId ? 'task' : 'dashboard';
    const resourceId: string =
      args.taskId ?? args.projectId ?? args.organizationId;

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
        params: args.params,
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
        params: args.params,
        resourceType,
        resourceId,
        taskId: args.taskId ?? (task ? task._id : undefined),
      });
      notified += 1;
    }
    return { notified };
  },
});
