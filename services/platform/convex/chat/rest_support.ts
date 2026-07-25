/**
 * The chat reads and writes an API-key caller performs, keyed by an EXPLICIT
 * identity.
 *
 * The public chat functions resolve the caller from `ctx.auth` — the Convex
 * identity a browser session has and an organization API key does not. Rather
 * than loosen those functions, this module restates each one the REST surface
 * needs with the identity as an argument: `(organizationId, userId)`.
 *
 * The ACCESS RULE is unchanged and is not re-invented here. A thread is
 * user-private, so every function below loads it through
 * {@link loadOwnedThread} — the same `(organizationId, userId)` pair check
 * `threads.ts` applies, walked as the index rather than filtered afterwards. A
 * thread belonging to another member, or to another organization, reads as
 * ABSENT: a missing thread and a forbidden one are indistinguishable to a
 * caller by design, so an API key can neither read nor write across that line.
 *
 * Everything here is internal: it is unreachable from a client, and the only
 * caller is `chat/rest_api.ts`, which proves the identity from the API key
 * before it calls.
 */

import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from '../_generated/server';
import { chatKindValidator } from './schema';

/** One row of the REST thread listing. */
const threadViewValidator = v.object({
  id: v.id('threads'),
  title: v.optional(v.string()),
  kind: chatKindValidator,
  agentSlug: v.optional(v.string()),
  harness: v.optional(v.string()),
  projectId: v.optional(v.id('projects')),
  archived: v.boolean(),
  isShared: v.optional(v.boolean()),
  createdAt: v.number(),
  updatedAt: v.number(),
  generating: v.boolean(),
});

/** One message as REST renders it — the same projection `listMessages` returns. */
const messageViewValidator = v.object({
  id: v.id('messages'),
  role: v.union(
    v.literal('user'),
    v.literal('assistant'),
    v.literal('tool'),
    v.literal('system'),
  ),
  parts: v.any(),
  sequence: v.number(),
  model: v.optional(v.string()),
  providerSlug: v.optional(v.string()),
  blockedReason: v.optional(v.string()),
  error: v.optional(v.string()),
  createdAt: v.number(),
});

/**
 * Load a thread and confirm it belongs to the caller's `(org, user)` pair.
 * Returns null when it does not exist or is owned by someone else — the same
 * conflation `threads.ts::loadOwnedThread` makes, for the same reason.
 */
async function loadOwnedThread(
  ctx: QueryCtx,
  organizationId: string,
  userId: string,
  threadId: string,
): Promise<Doc<'threads'> | null> {
  const normalized = ctx.db.normalizeId('threads', threadId);
  if (!normalized) return null;
  const thread = await ctx.db.get(normalized);
  if (
    !thread ||
    thread.organizationId !== organizationId ||
    thread.userId !== userId
  ) {
    return null;
  }
  return thread;
}

function toThreadView(thread: Doc<'threads'>, generating: boolean) {
  return {
    id: thread._id,
    ...(thread.title !== undefined && { title: thread.title }),
    kind: thread.kind,
    ...(thread.agentSlug !== undefined && { agentSlug: thread.agentSlug }),
    ...(thread.harness !== undefined && { harness: thread.harness }),
    ...(thread.projectId !== undefined && { projectId: thread.projectId }),
    archived: thread.archived,
    ...(thread.isShared !== undefined && { isShared: thread.isShared }),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    generating,
  };
}

/** The key holder's own threads, newest first, cursor-paginated. */
export const restListThreads = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  returns: v.object({
    page: v.array(threadViewValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('threads')
      .withIndex('by_org_user_updated', (q) =>
        q.eq('organizationId', args.organizationId).eq('userId', args.userId),
      )
      .order('desc')
      .paginate({ numItems: args.limit, cursor: args.cursor });

    // The `generations` row exists exactly while a turn is in flight, so its
    // presence IS the "is generating" signal — read per page rather than from a
    // column, so a streaming turn never rewrites a row this listing reads.
    const page = [];
    for (const thread of result.page) {
      const generation = await ctx.db
        .query('generations')
        .withIndex('by_thread', (q) => q.eq('threadId', thread._id))
        .first();
      page.push(toThreadView(thread, generation !== null));
    }
    return {
      page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** One of the key holder's threads, or null when it is not theirs. */
export const restGetThread = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    threadId: v.string(),
  },
  returns: v.union(v.null(), threadViewValidator),
  handler: async (ctx, args) => {
    const thread = await loadOwnedThread(
      ctx,
      args.organizationId,
      args.userId,
      args.threadId,
    );
    if (!thread) return null;
    const generation = await ctx.db
      .query('generations')
      .withIndex('by_thread', (q) => q.eq('threadId', thread._id))
      .first();
    return toThreadView(thread, generation !== null);
  },
});

/** A thread's messages in sequence order, cursor-paginated. Null when the
 * thread is not the caller's — the handler answers 404, so an existing thread
 * owned by someone else is indistinguishable from a missing one. */
export const restListMessages = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    threadId: v.string(),
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  returns: v.union(
    v.null(),
    v.object({
      page: v.array(messageViewValidator),
      isDone: v.boolean(),
      continueCursor: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const thread = await loadOwnedThread(
      ctx,
      args.organizationId,
      args.userId,
      args.threadId,
    );
    if (!thread) return null;
    const result = await ctx.db
      .query('messages')
      .withIndex('by_thread_sequence', (q) => q.eq('threadId', thread._id))
      .paginate({ numItems: args.limit, cursor: args.cursor });
    return {
      page: result.page.map((message) => ({
        id: message._id,
        role: message.role,
        parts: message.parts,
        sequence: message.sequence,
        ...(message.model !== undefined && { model: message.model }),
        ...(message.providerSlug !== undefined && {
          providerSlug: message.providerSlug,
        }),
        ...(message.blockedReason !== undefined && {
          blockedReason: message.blockedReason,
        }),
        ...(message.error !== undefined && { error: message.error }),
        createdAt: message.createdAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * The live generation for one of the caller's threads, or null when the thread
 * is idle OR not theirs. The two collapse deliberately: the handler reports
 * `idle` for both, and a caller who does not own the thread has already been
 * refused by the read that fetched it.
 */
export const restGetGeneration = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    threadId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      status: v.union(
        v.literal('queued'),
        v.literal('streaming'),
        v.literal('waiting-approval'),
        v.literal('waiting-input'),
      ),
      waitingOn: v.optional(v.string()),
      messageId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const thread = await loadOwnedThread(
      ctx,
      args.organizationId,
      args.userId,
      args.threadId,
    );
    if (!thread) return null;
    const generation = await ctx.db
      .query('generations')
      .withIndex('by_thread', (q) => q.eq('threadId', thread._id))
      .first();
    if (!generation) return null;
    return {
      status: generation.status,
      ...(generation.waitingOn !== undefined && {
        waitingOn: generation.waitingOn,
      }),
      ...(generation.messageId !== undefined && {
        messageId: generation.messageId,
      }),
    };
  },
});

/**
 * Start a thread owned by the key holder.
 *
 * A project link is access-checked with the SAME gate `createThread` uses —
 * filing a thread must never smuggle a caller into a project they cannot read.
 */
export const restCreateThread = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    kind: chatKindValidator,
    title: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
    projectId: v.optional(v.string()),
  },
  returns: v.id('threads'),
  handler: async (ctx, args) => {
    let projectId: Doc<'projects'>['_id'] | undefined;
    if (args.projectId !== undefined) {
      const normalized = ctx.db.normalizeId('projects', args.projectId);
      if (normalized === null) {
        throw new ConvexError({
          code: 'PROJECT_NOT_FOUND',
          message: `No such project: ${args.projectId}`,
        });
      }
      const access = await ctx.runQuery(
        internal.projects.internal_queries.assertProjectAccessForChat,
        {
          projectId: normalized,
          organizationId: args.organizationId,
          userId: args.userId,
        },
      );
      if (!access.allowed) {
        throw new ConvexError({
          code:
            access.reason === 'not_found'
              ? 'PROJECT_NOT_FOUND'
              : 'PROJECT_FORBIDDEN',
          message:
            access.reason === 'not_found'
              ? `No such project: ${args.projectId}`
              : 'You do not have access to that project.',
        });
      }
      projectId = normalized;
    }

    const now = Date.now();
    return await ctx.db.insert('threads', {
      organizationId: args.organizationId,
      userId: args.userId,
      kind: args.kind,
      ...(args.title !== undefined && { title: args.title }),
      ...(args.agentSlug !== undefined && { agentSlug: args.agentSlug }),
      ...(projectId !== undefined && { projectId }),
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});
