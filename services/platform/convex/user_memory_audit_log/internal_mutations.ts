import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';

const actionValidator = v.union(
  v.literal('propose'),
  v.literal('create'),
  v.literal('approve'),
  v.literal('dismiss'),
  v.literal('update'),
  v.literal('invalidate'),
  v.literal('delete'),
  v.literal('inject'),
);

const outcomeValidator = v.union(
  v.literal('ok'),
  v.literal('denied'),
  v.literal('error'),
);

/**
 * Append a single audit-log row. The only writer for `userMemoryAuditLog` —
 * mutations and the chat-injection path call this through
 * `ctx.runMutation(internal.user_memory_audit_log.internal_mutations.appendAudit, {...})`.
 *
 * Both `subjectUserId` and `actorUserId` are stored raw. Admin-blind
 * pseudonymisation can be reintroduced when an admin-readable audit view
 * ships.
 */
export const appendAudit = internalMutation({
  args: {
    organizationId: v.string(),
    actorUserId: v.string(),
    subjectUserId: v.string(),
    action: actionValidator,
    outcome: outcomeValidator,
    memoryId: v.optional(v.id('userMemories')),
    injectedMemoryIds: v.optional(v.array(v.id('userMemories'))),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('userMemoryAuditLog', {
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      subjectUserId: args.subjectUserId,
      action: args.action,
      outcome: args.outcome,
      memoryId: args.memoryId,
      injectedMemoryIds: args.injectedMemoryIds,
      threadId: args.threadId,
      messageId: args.messageId,
      agentSlug: args.agentSlug,
      requestId: args.requestId,
      createdAt: Date.now(),
    });
  },
});
