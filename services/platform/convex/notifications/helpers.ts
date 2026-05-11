import type { MutationCtx } from '../_generated/server';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_SEVERITIES } from './schema';

type Category = (typeof NOTIFICATION_CATEGORIES)[number];
type Severity = (typeof NOTIFICATION_SEVERITIES)[number];

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
      createdAt: now,
      readBy: [],
    });
  }
}
