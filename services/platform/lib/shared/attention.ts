/**
 * Attention / return-loop classification for personal notifications.
 * Kept in lib/shared so the app filter and Convex emitters stay aligned.
 */

export const ACTIONABLE_NOTIFICATION_TYPES = [
  'task_review_requested',
  // A controlled document waiting on its named reviewer is the same
  // human-in-the-loop gate as a task review — it emails too.
  'document_review_requested',
  'mention',
  'task_assigned',
  // A date that has arrived (start today, due within the day, already late) is
  // the person's move to make, so it leaves the app — the bell alone only
  // reaches someone already looking at Tale. `task_unassigned` deliberately
  // stays out: losing work needs no action.
  'task_deadline',
  'agent_escalation',
  // Inbound conversation messages route to the assignee (or org admins) and
  // need a reply, so they deliver by email too — not just the in-app bell.
  'conversation_message',
  // A conversation assigned to a member is a targeted hand-off that needs their
  // attention, so it emails the new assignee (mirrors task_assigned).
  'conversation_assigned',
] as const;

type ActionableNotificationType =
  (typeof ACTIONABLE_NOTIFICATION_TYPES)[number];

const ACTIONABLE_SET = new Set<string>(ACTIONABLE_NOTIFICATION_TYPES);

export function isActionableNotificationType(type: string): boolean {
  return ACTIONABLE_SET.has(type);
}
