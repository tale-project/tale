import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';

const filterNameValidator = v.union(
  v.literal('pii'),
  v.literal('chat_filter'),
  v.literal('moderation_provider'),
);

const directionValidator = v.union(v.literal('input'), v.literal('output'));

const kindValidator = v.union(
  v.literal('detected'),
  v.literal('blocked'),
  v.literal('step_error'),
  v.literal('circuit_open'),
);

const errorClassValidator = v.union(
  v.literal('timeout'),
  v.literal('network'),
  v.literal('parse'),
  v.literal('http_4xx'),
  v.literal('http_5xx'),
  v.literal('config'),
  v.literal('unknown'),
);

const actorTypeValidator = v.union(
  v.literal('user'),
  v.literal('api'),
  v.literal('assistant'),
  v.literal('system'),
);

/**
 * Insert a single aggregated outcome row. Call once per
 * (sanitizationRunId, filterName, direction) tuple — callers accumulate
 * category/match counts in-memory during a sanitize run and flush here.
 *
 * Raw matched text MUST NOT be sent here; schema deliberately has no field
 * for it. The code-comment invariant in sanitize.ts reinforces this.
 */
export const recordEvent = internalMutation({
  args: {
    organizationId: v.string(),
    sanitizationRunId: v.string(),
    threadId: v.string(),
    messageId: v.optional(v.string()),
    filterName: filterNameValidator,
    direction: directionValidator,
    kind: kindValidator,
    categoryIds: v.array(v.string()),
    matchCount: v.optional(v.number()),
    truncated: v.optional(v.boolean()),
    errorClass: v.optional(errorClassValidator),
    httpStatus: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    attempt: v.optional(v.number()),
    agentSlug: v.optional(v.string()),
    actorType: v.optional(actorTypeValidator),
  },
  returns: v.id('chatFilterEvents'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('chatFilterEvents', {
      ...args,
      createdAt: Date.now(),
    });
  },
});
