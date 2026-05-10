import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../lib/validators/json';

export const NOTIFICATION_CATEGORIES = ['security', 'system'] as const;
export const NOTIFICATION_SEVERITIES = ['info', 'warning', 'critical'] as const;

const categoryValidator = v.union(
  ...NOTIFICATION_CATEGORIES.map((c) => v.literal(c)),
);
const severityValidator = v.union(
  ...NOTIFICATION_SEVERITIES.map((s) => v.literal(s)),
);

export const notificationsTable = defineTable({
  organizationId: v.string(),
  category: categoryValidator,
  severity: severityValidator,
  // i18n key, e.g. 'notifications.accountLocked'
  titleKey: v.string(),
  // i18n key, e.g. 'notifications.lockoutDetails'
  bodyKey: v.string(),
  // ICU params for both title and body
  params: v.optional(jsonRecordValidator),
  /**
   * Subject (data-subject) user this notification is *about* — distinct
   * from the audience (the org admins reading the notifications bell).
   * Populated when the notification carries subject PII in `params`
   * (e.g. lockout alerts naming the locked-out user). GDPR Art 17
   * `eraseSubjectNotifications` matches on this column so erasure is
   * stable across audit-pepper rotations and survives email changes.
   * Optional and indexed sparsely: legacy rows pre-fix have it
   * undefined and fall back to a best-effort email-hash match.
   */
  subjectUserId: v.optional(v.string()),
  createdAt: v.number(),
  // userIds (Better Auth user document _id, stored as string) that have dismissed this notification
  readBy: v.array(v.string()),
})
  .index('by_org_created', ['organizationId', 'createdAt'])
  .index('by_org_subject', ['organizationId', 'subjectUserId']);
