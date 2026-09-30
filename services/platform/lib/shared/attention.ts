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
  // An agent's run failed for good: the task sits at In progress with
  // nothing working on it until the person who started the agent comes back
  // — and they left the task the moment they started it — so it emails too.
  'agent_run_failed',
  // Inbound conversation messages route to the assignee (or org admins) and
  // need a reply, so they deliver by email too — not just the in-app bell.
  'conversation_message',
  // A conversation assigned to a member is a targeted hand-off that needs their
  // attention, so it emails the new assignee (mirrors task_assigned).
  'conversation_assigned',
  // A cloud sync the member owns stopped working: reconnecting the account is
  // theirs alone to do, and a frozen mirror is invisible from inside Tale
  // until someone looks — so it leaves the app too.
  'cloud_sync_failed',
  // A member is blocked by a usage limit until an owner or admin raises it,
  // and the member cannot reach them from inside Tale — so it emails too.
  'usage_credits_requested',
  // A schedule paused itself after repeated failures and starts nothing
  // until an owner or admin fixes it and turns it back on — the work it did
  // has silently stopped, so it leaves the app too.
  'automation_failed',
] as const;

const ACTIONABLE_SET = new Set<string>(ACTIONABLE_NOTIFICATION_TYPES);

export function isActionableNotificationType(type: string): boolean {
  return ACTIONABLE_SET.has(type);
}
