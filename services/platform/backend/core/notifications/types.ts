export const NOTIFICATION_CATEGORIES = ['security', 'system'] as const;
export const NOTIFICATION_SEVERITIES = ['info', 'warning', 'critical'] as const;

/**
 * Optional in-app deep-link target for a notification. The client maps each
 * `kind` to a concrete dashboard route (see `notification-target.ts`) so the
 * stored value stays route-agnostic (survives route refactors, locale-safe).
 * Closed union — the client only knows how to route these kinds.
 */
export type NotificationLink =
  | { kind: 'agent'; agentSlug: string }
  // Optional `logId` deep-links to the specific broken audit row (#1845). Kept
  // optional so it's data-safe (widened member, no migration) and so findings
  // without a concrete row — e.g. a config/checkpoint gap — still link to the
  // audit-log page.
  | { kind: 'audit-logs'; logId?: string }
  | { kind: 'dsar' }
  | { kind: 'security-monitoring' };
