/**
 * Collaboration vocabulary: per-user content notifications, task
 * subscriptions, and per-user notification preferences.
 *
 * Content notifications use a PER-USER row (one row per recipient) rather than
 * the org-wide `notifications` table's `readBy[]` array, which does not scale to
 * large orgs. The org `notifications` table stays for system/security alerts.
 */

export type NotificationType =
  | 'task_assigned'
  // The assignee was removed and nobody replaced them (or someone else did):
  // the person who was carrying it is told they no longer are. Bell only —
  // losing work is not an inbox action.
  | 'task_unassigned'
  | 'task_status_changed'
  | 'task_commented'
  | 'mention'
  // Start date reached / due soon / overdue. Its own type (not
  // `task_status_changed`) so muting board churn can't mute a deadline, and so
  // it can email the person carrying the work.
  | 'task_deadline'
  // --- Task-ops automation types. ---
  // Work awaits human review (the in_review gate — agent OR human
  // submission). Actionable.
  | 'task_review_requested'
  // A review the user was watching was approved / sent back.
  | 'task_review_resolved'
  // The user was designated a task's reviewer while the work is still in
  // flight — a heads-up, so NOT actionable (bell only, no email). The
  // actionable request follows when the task reaches in_review.
  | 'task_reviewer_assigned'
  // A controlled document was submitted to the user for review
  // (documents/records.ts). Actionable — the named reviewer must know.
  | 'document_review_requested'
  // The user's controlled-document submission was approved / sent back.
  | 'document_review_resolved'
  // An agent needs a human: an automation turn parked on an `ask_human`
  // question (`collab/notify_agent_asks.ts`), or a root escalation / circuit
  // breaker. Actionable.
  | 'agent_escalation'
  // RETIRED with the 0.4 emitters that never made the port: the
  // `automation_alerts` group (automation_failed / budget_alert /
  // runtime_offline). Their preference column stays deprecated in
  // `app.notification_preferences`; a revived producer re-adds the literal
  // and the PREF_FIELD row together.
  // RETIRED — no emitter writes this type anymore (the digest automation was
  // removed). The literal stays so stored rows keep typing; drop it once the
  // stored rows are gone.
  | 'workforce_digest'
  // Inbound customer message in Conversations (automation-driven).
  | 'conversation_message'
  // A conversation was assigned to a member by an admin (targeted; the new
  // assignee is notified, mirroring task_assigned). Actionable.
  | 'conversation_assigned';

export type NotificationActorType = 'user' | 'agent' | 'system';

export type SubscriptionReason =
  | 'creator'
  | 'assignee'
  | 'commenter'
  | 'mention'
  // The designated reviewer follows the task from designation onward: they own
  // the gate, so they need its progress (comments, status, outcome) — not just
  // the moment the request lands.
  | 'reviewer'
  | 'manual';
