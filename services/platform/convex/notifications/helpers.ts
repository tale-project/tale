import type { Infer } from 'convex/values';

import type { MutationCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import type {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SEVERITIES,
  notificationLinkValidator,
} from './schema';

type Category = (typeof NOTIFICATION_CATEGORIES)[number];
type Severity = (typeof NOTIFICATION_SEVERITIES)[number];

/**
 * Whether a member with `role` may see a notification of `category` in the
 * bell. `security` notifications (audit-integrity alerts, login lockouts, …)
 * are admin-only: they describe security posture and can name subjects, so they
 * must not fan out to every org member (#1845). Everyone sees the rest. Single
 * source of truth so `list`, `unreadCount`, and `markAllRead` cannot drift out
 * of agreement on who sees what.
 */
export function canSeeNotification(
  role: string | null | undefined,
  category: Category,
): boolean {
  return category !== 'security' || isAdmin(role);
}

interface WriteNotificationArgs {
  organizationIds: string[];
  category: Category;
  severity: Severity;
  titleKey: string;
  bodyKey: string;
  params?: Record<string, unknown>;
  /**
   * The data subject this notification is *about* (distinct from the
   * audience — admins reading the notifications bell). Populating this
   * lets `eraseSubjectNotifications` (GDPR Art 17) match by userId
   * regardless of audit-pepper rotation or email change.
   */
  subjectUserId?: string;
  /** Optional in-app deep-link target for the notification body. */
  link?: Infer<typeof notificationLinkValidator>;
}

/**
 * Insert one notification per organization. Used by background events
 * (e.g. login lockouts) that need to fan out to admins of every org the
 * affected user belongs to.
 */
export async function writeNotificationForOrgs(
  ctx: MutationCtx,
  args: WriteNotificationArgs,
): Promise<void> {
  const now = Date.now();
  for (const organizationId of args.organizationIds) {
    await ctx.db.insert('notifications', {
      organizationId,
      category: args.category,
      severity: args.severity,
      titleKey: args.titleKey,
      bodyKey: args.bodyKey,
      params: args.params,
      subjectUserId: args.subjectUserId,
      link: args.link,
      createdAt: now,
      readBy: [],
    });
  }

  // Mirror security alerts to external notification channels (Slack today).
  // The dispatcher/sink decide per-org whether Slack is connected and the
  // event enabled, so this stays an unconditional best-effort fan-out. We pass
  // the i18n KEYS plus the interpolation params (NOT pre-rendered text) so the
  // dispatcher can render in each org's locale — matching the in-app bell.
  if (args.category === 'security') {
    for (const organizationId of args.organizationIds) {
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.dispatch_notification.dispatchNotificationAction,
        {
          organizationId,
          eventType: 'security.alert',
          params: {
            titleKey: args.titleKey,
            bodyKey: args.bodyKey,
            params: args.params,
          },
        },
      );
    }
  }
}
