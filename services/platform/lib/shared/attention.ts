/**
 * Attention / return-loop classification for personal notifications.
 * Kept in lib/shared so the app filter and Convex emitters stay aligned.
 */

export const ACTIONABLE_NOTIFICATION_TYPES = [
  'task_review_requested',
  'mention',
  'task_assigned',
  'agent_escalation',
  // Inbound conversation messages route to the assignee (or org admins) and
  // need a reply, so they deliver by email too — not just the in-app bell.
  'conversation_message',
] as const;

type ActionableNotificationType =
  (typeof ACTIONABLE_NOTIFICATION_TYPES)[number];

const ACTIONABLE_SET = new Set<string>(ACTIONABLE_NOTIFICATION_TYPES);

export function isActionableNotificationType(type: string): boolean {
  return ACTIONABLE_SET.has(type);
}
