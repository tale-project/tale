/**
 * Convex validators for thread operations
 */

import { v } from 'convex/values';

export const chatTypeValidator = v.union(
  v.literal('general'),
  v.literal('workflow_assistant'),
  v.literal('agent_test'),
);

export const messageRoleValidator = v.union(
  v.literal('user'),
  v.literal('assistant'),
);

/**
 * Thread lifecycle states:
 *   - `active`            — visible in main list, normal use
 *   - `archived`          — user-archived, round-trippable via `unarchiveChatThread`
 *   - `trashed`           — user-deleted (visible in user Trash, restorable by owner/admin)
 *   - `expired`           — retention-policy auto-deleted (admin-only Trash, restorable by admin)
 *   - `deleted`           — DEPRECATED (legacy tombstone). Treated as `trashed` for read paths
 *                           pending one-shot migration. New writes use `trashed`/`expired`.
 *
 * `trashed` and `expired` are both grace-windowed by `statusChangedAt`; once
 * `now - statusChangedAt > graceDays`, retention Pass B physically deletes
 * the row + cascades children. Origin only affects user-visibility and
 * restore-permission, not physical disposal.
 */
export const threadStatusValidator = v.union(
  v.literal('active'),
  v.literal('archived'),
  v.literal('trashed'),
  v.literal('expired'),
  v.literal('deleted'),
);

export const toolStatusValidator = v.union(
  v.literal('calling'),
  v.literal('completed'),
  v.null(),
);

export const threadMessageValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  role: messageRoleValidator,
  content: v.string(),
});

export const threadListItemValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  title: v.optional(v.string()),
  status: threadStatusValidator,
  userId: v.optional(v.string()),
  teamId: v.optional(v.string()),
});

export const latestToolMessageValidator = v.object({
  toolNames: v.array(v.string()),
  status: toolStatusValidator,
  timestamp: v.union(v.number(), v.null()),
});

export const getOrCreateSubThreadResultValidator = v.object({
  threadId: v.string(),
  isNew: v.boolean(),
});
