import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../lib/validators/json';

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
  v.literal('task_status_changed'),
  v.literal('task_commented'),
  v.literal('mention'),
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
  // An agent escalated to humans (root escalation / circuit breaker).
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

export const userNotificationsTable = defineTable({
  userId: v.string(),
  organizationId: v.string(),
  type: notificationTypeValidator,
  titleKey: v.string(),
  bodyKey: v.string(),
  params: v.optional(jsonRecordValidator),
  resourceType: v.union(
    v.literal('task'),
    v.literal('comment'),
    v.literal('thread'),
    // Task-ops resources (deep-link targets for the types above).
    v.literal('task_review'),
    v.literal('wf_execution'),
    v.literal('runtime'),
    v.literal('dashboard'),
    v.literal('conversation'),
    // Controlled-document reviews: the request row carries the approval id,
    // the outcome row the document id (mirrors task_review/task).
    v.literal('document_review'),
    v.literal('document'),
  ),
  resourceId: v.string(),
  taskId: v.optional(v.id('tasks')),
  actorType: notificationActorTypeValidator,
  actorId: v.optional(v.string()),
  read: v.boolean(),
  readAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index('by_user_org_created', ['userId', 'organizationId', 'createdAt'])
  .index('by_user_org_read', ['userId', 'organizationId', 'read', 'createdAt']);

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

export const taskSubscriptionsTable = defineTable({
  organizationId: v.string(),
  taskId: v.id('tasks'),
  subscriberType: v.union(v.literal('user'), v.literal('agent')),
  subscriberId: v.string(),
  reason: subscriptionReasonValidator,
  muted: v.optional(v.boolean()),
  createdAt: v.number(),
})
  .index('by_task', ['taskId'])
  .index('by_task_subscriber', ['taskId', 'subscriberType', 'subscriberId'])
  .index('by_subscriber', ['organizationId', 'subscriberType', 'subscriberId']);

/**
 * Tri-state per-user notification preferences (undefined = follow system
 * default; true/false = explicit override). Mirrors `userPreferences`.
 */
export const notificationPreferencesTable = defineTable({
  userId: v.string(),
  organizationId: v.string(),
  taskAssigned: v.optional(v.boolean()),
  taskStatusChanged: v.optional(v.boolean()),
  taskCommented: v.optional(v.boolean()),
  mention: v.optional(v.boolean()),
  // Task-ops preference groups. `taskReview` and `escalation` are
  // human-in-the-loop safety signals: the fan-out skips the pref check for
  // the designated reviewer so the review gate can never starve silently.
  taskReview: v.optional(v.boolean()),
  escalation: v.optional(v.boolean()),
  // Groups automation_failed / budget_alert / runtime_offline.
  automationAlerts: v.optional(v.boolean()),
  // RETIRED — nothing maps to `digest` since the workforce digest died; the
  // 0.3.4 migration strips stored values, 0.3.5 drops the field.
  digest: v.optional(v.boolean()),
  /** Inbound customer messages in Conversations (automation-driven). */
  conversationMessages: v.optional(v.boolean()),
  /** Master toggle for actionable return-loop email delivery. */
  actionableEmail: v.optional(v.boolean()),
  updatedAt: v.number(),
}).index('by_userId_organizationId', ['userId', 'organizationId']);
