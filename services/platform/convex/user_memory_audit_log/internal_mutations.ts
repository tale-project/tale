import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { hmacUserId } from '../user_memories/audit_pseudonym';

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
 * Subject userId is HMAC-pseudonymised before write so org admins cannot
 * identify the row owner. The `actorUserId` is stored raw (the actor is the
 * principal; pseudonymising it would defeat the purpose of the trail).
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
    const subjectUserIdHmac = await hmacUserId(args.subjectUserId);
    await ctx.db.insert('userMemoryAuditLog', {
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      subjectUserIdHmac,
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
