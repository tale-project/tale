/**
 * Attention / return-loop classification for personal notifications.
 * Kept in lib/shared so the app filter and Convex emitters stay aligned.
 */

export const ACTIONABLE_NOTIFICATION_TYPES = [
  'task_review_requested',
  'mention',
  'task_assigned',
  'agent_escalation',
] as const;

export type ActionableNotificationType =
  (typeof ACTIONABLE_NOTIFICATION_TYPES)[number];

const ACTIONABLE_SET = new Set<string>(ACTIONABLE_NOTIFICATION_TYPES);

export function isActionableNotificationType(type: string): boolean {
  return ACTIONABLE_SET.has(type);
}
