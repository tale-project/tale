/**
 * Schedules per-recipient email delivery for actionable return-loop notifications.
 * Runs inside the same mutation as the in-app row insert — fire-and-forget via the
 * scheduler so SMTP latency cannot block the write path.
 */

import type { Infer } from 'convex/values';

import { isActionableNotificationType } from '../../lib/shared/attention';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { notificationTypeValidator } from './schema';

type NotificationType = Infer<typeof notificationTypeValidator>;

export async function queueActionableEmail(
  ctx: MutationCtx,
  args: {
    userId: string;
    organizationId: string;
    type: NotificationType;
    titleKey: string;
    bodyKey: string;
    params?: Record<string, unknown>;
    resourceType: string;
    resourceId: string;
    taskId?: Id<'tasks'>;
  },
): Promise<void> {
  if (!isActionableNotificationType(args.type)) return;

  await ctx.scheduler.runAfter(
    0,
    internal.notifications.email_notification.deliverActionableEmailAction,
    {
      userId: args.userId,
      organizationId: args.organizationId,
      type: args.type,
      titleKey: args.titleKey,
      bodyKey: args.bodyKey,
      params: args.params,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      taskId: args.taskId,
    },
  );
}
