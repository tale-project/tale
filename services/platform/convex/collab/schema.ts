import { v } from 'convex/values';
/**
 * Collaboration tables: per-user content notifications, task subscriptions, and
 * per-user notification preferences.
 *
 * Content notifications use a PER-USER row (one row per recipient) rather than
 * the org-wide `notifications` table's `readBy[]` array, which does not scale to
 * large orgs. The org `notifications` table stays for system/security alerts.
 */

export const notificationTypeValidator = v.union(
  v.literal('task_assigned'),
  // The assignee was removed and nobody replaced them (or someone else did):
  // the person who was carrying it is told they no longer are. Bell only —
  // losing work is not an inbox action.
  v.literal('task_unassigned'),
  v.literal('task_status_changed'),
  v.literal('task_commented'),
  v.literal('mention'),
  // Start date reached / due soon / overdue. Its own type (not
  // `task_status_changed`) so muting board churn can't mute a deadline, and so
  // it can email the person carrying the work.
  v.literal('task_deadline'),
  // --- Task-ops automation types. Schema ships one release ahead of the
  // emitters (closed-union deploy-order constraint). ---
  // Work awaits human review (the in_review gate — agent OR human
  // submission). Actionable.
  v.literal('task_review_requested'),
  // A review the user was watching was approved / sent back.
  v.literal('task_review_resolved'),
  // The user was designated a task's reviewer while the work is still in
  // flight — a heads-up, so NOT actionable (bell only, no email). The
  // actionable request follows when the task reaches in_review.
  v.literal('task_reviewer_assigned'),
  // A controlled document was submitted to the user for review
  // (documents/records.ts). Actionable — the named reviewer must know.
  v.literal('document_review_requested'),
  // The user's controlled-document submission was approved / sent back.
  v.literal('document_review_resolved'),
  // An agent needs a human: an automation turn parked on an `ask_human`
  // question (`collab/notify_agent_asks.ts`), or a root escalation / circuit
  // breaker. Actionable.
  v.literal('agent_escalation'),
  // A task-ops pack workflow execution failed (admins).
  v.literal('automation_failed'),
  // Agent budget warn/pause threshold crossed (admins).
  v.literal('budget_alert'),
  // An external agent runtime went offline (admins).
  v.literal('runtime_offline'),
  // RETIRED — no emitter writes this type anymore (the digest automation was
  // removed) and migration 0.2.90/08 deletes the stored rows. The literal
  // stays one release because the closed union validates EXISTING rows at
  // schema push time (same deploy-order constraint as adding a type, in
  // reverse); drop it in the next release.
  v.literal('workforce_digest'),
  // Inbound customer message in Conversations (automation-driven).
  v.literal('conversation_message'),
  // A conversation was assigned to a member by an admin (targeted; the new
  // assignee is notified, mirroring task_assigned). Actionable.
  v.literal('conversation_assigned'),
);

export const notificationActorTypeValidator = v.union(
  v.literal('user'),
  v.literal('agent'),
  v.literal('system'),
);
export const subscriptionReasonValidator = v.union(
  v.literal('creator'),
  v.literal('assignee'),
  v.literal('commenter'),
  v.literal('mention'),
  // The designated reviewer follows the task from designation onward: they own
  // the gate, so they need its progress (comments, status, outcome) — not just
  // the moment the request lands.
  v.literal('reviewer'),
  v.literal('manual'),
);
