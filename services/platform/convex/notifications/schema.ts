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

/**
 * Optional in-app deep-link target for a notification. The client maps each
 * `kind` to a concrete dashboard route (see `notification-target.ts`) so the
 * stored value stays route-agnostic (survives route refactors, locale-safe).
 * Closed union — schema ships one release ahead of new emitters, per the
 * Convex closed-union deploy-order constraint.
 */
export const notificationLinkValidator = v.union(
  v.object({ kind: v.literal('agent'), agentSlug: v.string() }),
  // Optional `logId` deep-links to the specific broken audit row (#1845). Kept
  // optional so it's data-safe (widened member, no migration) and so findings
  // without a concrete row — e.g. a config/checkpoint gap — still link to the
  // audit-log page.
  v.object({ kind: v.literal('audit-logs'), logId: v.optional(v.string()) }),
  v.object({ kind: v.literal('dsar') }),
  v.object({ kind: v.literal('security-monitoring') }),
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
  // Optional in-app deep-link target. Legacy rows pre-fix have it undefined and
  // render without a body link (icon-only mark-as-read).
  link: v.optional(notificationLinkValidator),
  createdAt: v.number(),
  // userIds (Better Auth user document _id, stored as string) that have dismissed this notification
  readBy: v.array(v.string()),
})
  .index('by_org_created', ['organizationId', 'createdAt'])
  .index('by_org_subject', ['organizationId', 'subjectUserId']);
