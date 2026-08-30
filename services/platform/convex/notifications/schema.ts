import { v } from 'convex/values';
export const NOTIFICATION_CATEGORIES = ['security', 'system'] as const;
export const NOTIFICATION_SEVERITIES = ['info', 'warning', 'critical'] as const;

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
