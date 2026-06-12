/**
 * Notification workflow action — lets automations reach HUMANS through the
 * in-app inbox (the human half of human-in-the-loop). Used across the
 * task-ops pack: due-date warnings, SLA escalations, review reminders,
 * unblock pings, the daily digest.
 *
 * Operations:
 *  - `notify_users`: per-user inbox rows to a declarative audience
 *    (`task_assignee` | `task_subscribers` | `project_creator` |
 *    `org_admins` | explicit `user_ids`). Preferences respected, repeated
 *    cron firings deduped — see `collab/internal_mutations.ts`.
 *  - `notify_org_channel`: one org-wide notification-bell entry (the
 *    admin-facing operational feed), severity-tagged.
 *
 * `titleKey`/`bodyKey` are i18n KEYS (rendered in each recipient's locale),
 * with `params` as the interpolation map — never pre-rendered text.
 */

import { v } from 'convex/values';

import { internal } from '../../../_generated/api';
import { toId } from '../../../lib/type_cast_helpers';
import {
  jsonRecordValidator,
  type ConvexJsonRecord,
} from '../../../lib/validators/json';
import type { ActionDefinition } from '../../helpers/nodes/action/types';

type NotificationActionParams =
  | {
      operation: 'notify_users';
      audience:
        | 'user_ids'
        | 'task_assignee'
        | 'task_subscribers'
        | 'project_creator'
        | 'org_admins';
      type:
        | 'task_assigned'
        | 'task_status_changed'
        | 'task_commented'
        | 'mention'
        | 'task_review_requested'
        | 'task_review_resolved'
        | 'agent_escalation'
        | 'automation_failed'
        | 'budget_alert'
        | 'runtime_offline'
        | 'workforce_digest';
      titleKey: string;
      bodyKey: string;
      params?: ConvexJsonRecord;
      taskId?: string;
      projectId?: string;
      userIds?: string[];
    }
  | {
      operation: 'notify_org_channel';
      severity: 'info' | 'warning' | 'critical';
      titleKey: string;
      bodyKey: string;
      params?: ConvexJsonRecord;
    };

const audienceValidator = v.union(
  v.literal('user_ids'),
  v.literal('task_assignee'),
  v.literal('task_subscribers'),
  v.literal('project_creator'),
  v.literal('org_admins'),
);

const userNotificationTypeValidator = v.union(
  v.literal('task_assigned'),
  v.literal('task_status_changed'),
  v.literal('task_commented'),
  v.literal('mention'),
  v.literal('task_review_requested'),
  v.literal('task_review_resolved'),
  v.literal('agent_escalation'),
  v.literal('automation_failed'),
  v.literal('budget_alert'),
  v.literal('runtime_offline'),
  v.literal('workforce_digest'),
);

export const notificationAction: ActionDefinition<NotificationActionParams> = {
  type: 'notification',
  title: 'Notification Operation',
  description:
    'Notify humans from an automation: notify_users writes per-user inbox notifications to a declarative audience (task_assignee, task_subscribers, project_creator, org_admins, user_ids) with preference + dedupe handling; notify_org_channel writes one org-wide bell entry. titleKey/bodyKey are i18n keys with params interpolation. organizationId is read from workflow context variables.',
  parametersValidator: v.union(
    v.object({
      operation: v.literal('notify_users'),
      audience: audienceValidator,
      type: userNotificationTypeValidator,
      titleKey: v.string(),
      bodyKey: v.string(),
      params: v.optional(jsonRecordValidator),
      taskId: v.optional(v.id('tasks')),
      projectId: v.optional(v.id('projects')),
      userIds: v.optional(v.array(v.string())),
    }),
    v.object({
      operation: v.literal('notify_org_channel'),
      severity: v.union(
        v.literal('info'),
        v.literal('warning'),
        v.literal('critical'),
      ),
      titleKey: v.string(),
      bodyKey: v.string(),
      params: v.optional(jsonRecordValidator),
    }),
  ),
  async execute(ctx, params, variables) {
    const organizationId = variables.organizationId;
    if (typeof organizationId !== 'string' || !organizationId) {
      throw new Error(
        'notification action requires a string organizationId in workflow context',
      );
    }

    switch (params.operation) {
      case 'notify_users': {
        const result = await ctx.runMutation(
          internal.collab.internal_mutations.notifyFromAutomation,
          {
            organizationId,
            audience: params.audience,
            type: params.type,
            titleKey: params.titleKey,
            bodyKey: params.bodyKey,
            params: params.params,
            taskId: params.taskId ? toId<'tasks'>(params.taskId) : undefined,
            projectId: params.projectId
              ? toId<'projects'>(params.projectId)
              : undefined,
            userIds: params.userIds,
          },
        );
        return { operation: 'notify_users', ...result };
      }

      case 'notify_org_channel': {
        await ctx.runMutation(
          internal.notifications.mutations.writeOrgNotification,
          {
            organizationId,
            severity: params.severity,
            titleKey: params.titleKey,
            bodyKey: params.bodyKey,
            params: params.params,
          },
        );
        return { operation: 'notify_org_channel', written: true };
      }

      default: {
        const unhandled: never = params;
        throw new Error(
          `Unsupported notification operation: ${JSON.stringify(unhandled)}`,
        );
      }
    }
  },
};
