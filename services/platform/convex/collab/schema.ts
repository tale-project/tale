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
  updatedAt: v.number(),
}).index('by_userId_organizationId', ['userId', 'organizationId']);
