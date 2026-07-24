/**
 * Threads — the conversations a user owns in one organization.
 *
 * Every function here scopes by BOTH the organization and the authenticated
 * user: a thread is user-private, so a member never sees another member's
 * conversations and no organization ever sees another's. The scoping is not a
 * filter applied after the fact — it is the index the read walks, so a thread
 * outside the caller's (org, user) pair is never loaded in the first place.
 *
 * Branching is modelled as a new thread rather than a mutation of the one it
 * came from: a fork copies the conversation up to a chosen message into a
 * fresh thread, so the original is never rewritten and the two histories
 * diverge cleanly from that point on.
 *
 * Sharing is the one deliberate crack in the user-privacy wall, and it is
 * opt-in, org-internal, and snapshotted: the owner mints an unguessable token,
 * any authenticated member of the SAME organization can read through it, and
 * the share exposes only the messages that existed at `sharedAt` — never the
 * turns that follow. Other organizations still see nothing.
 */

import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { chatKindValidator } from './schema';

/** One row of the thread list, already reduced to what the sub-panel renders. */
const threadSummaryValidator = v.object({
  id: v.id('threads'),
  title: v.optional(v.string()),
  kind: chatKindValidator,
  agentSlug: v.optional(v.string()),
  /** The coding agent pinned to a sandbox thread (absent on direct threads). */
  harness: v.optional(v.string()),
  /** The project the thread is filed under (absent = the loose Chats list). */
  projectId: v.optional(v.id('projects')),
  archived: v.boolean(),
  isShared: v.optional(v.boolean()),
  updatedAt: v.number(),
  generating: v.boolean(),
});

/** One message of a shared snapshot — the same projection `listMessages`
 * returns, re-declared here because the share read authorizes by token + org
 * membership rather than by thread ownership. */
const sharedMessageValidator = v.object({
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

/** A shared thread as the read-only page renders it. */
const sharedThreadValidator = v.object({
  threadId: v.id('threads'),
  title: v.optional(v.string()),
  sharedBy: v.string(),
  sharedAt: v.number(),
  agentSlug: v.optional(v.string()),
  messages: v.array(sharedMessageValidator),
});

/** 256 bits of Web Crypto randomness, hex encoded (64 chars) — the same
 * entropy budget and encoding as a SCIM bearer token, and URL-safe, because
 * the token is the whole credential of the share URL. */
function mintShareToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Resolve the caller, asserting they are still a member of the org. Returns
 * the authenticated user id every thread read and write scopes to. */
async function requireOrgUser(
  ctx: QueryCtx,
  organizationId: string,
): Promise<string> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) throw new Error('Unauthenticated');
  await getOrganizationMember(ctx, organizationId, authUser);
  return authUser.userId;
}

/** Load a thread and confirm it belongs to the caller's (org, user) pair.
 * Returns null when it does not exist or is owned by someone else — a missing
 * thread and a forbidden one are indistinguishable to a caller by design. */
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

/**
 * List the caller's threads, newest first, each tagged with whether a turn is
 * currently generating on it. The generating flag reads the `generations`
 * table — whose row exists exactly while a turn is in flight — rather than a
 * column on the thread, so a streaming turn never rewrites a row the list
 * reads.
 */
export const listThreads = query({
  args: { organizationId: v.string() },
  returns: v.array(threadSummaryValidator),
  handler: async (ctx, args) => {
    const userId = await requireOrgUser(ctx, args.organizationId);

    const threads = await ctx.db
      .query('threads')
      .withIndex('by_org_user_updated', (q) =>
        q.eq('organizationId', args.organizationId).eq('userId', userId),
      )
      .order('desc')
      .collect();

    // One scan of the org's live generations, turned into a set of the thread
    // ids that are generating. Cheaper than a per-thread lookup and still
    // org-scoped.
    const generating = new Set<string>();
    for (const generation of await ctx.db
      .query('generations')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect()) {
      generating.add(generation.threadId);
    }

    return threads.map((thread) => ({
      id: thread._id,
      title: thread.title,
      kind: thread.kind,
      agentSlug: thread.agentSlug,
      harness: thread.harness,
      projectId: thread.projectId,
      archived: thread.archived,
      isShared: thread.isShared,
      updatedAt: thread.updatedAt,
      generating: generating.has(thread._id),
    }));
  },
});

/** One thread, or null when it is not the caller's. */
export const getThread = query({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.union(threadSummaryValidator, v.null()),
  handler: async (ctx, args) => {
    const userId = await requireOrgUser(ctx, args.organizationId);
    const thread = await loadOwnedThread(
      ctx,
      args.organizationId,
      userId,
      args.threadId,
    );
    if (!thread) return null;
    const generation = await ctx.db
      .query('generations')
      .withIndex('by_thread', (q) => q.eq('threadId', thread._id))
      .first();
    return {
      id: thread._id,
      title: thread.title,
      kind: thread.kind,
      agentSlug: thread.agentSlug,
      harness: thread.harness,
      projectId: thread.projectId,
      archived: thread.archived,
      isShared: thread.isShared,
      updatedAt: thread.updatedAt,
      generating: generation !== null,
    };
  },
});

/** The thread facts a coding turn reads, scoped like every other read —
 * the (org, user) pair must own the thread. */
export const getOwnedThreadInternal = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    threadId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      kind: chatKindValidator,
      capabilities: v.optional(
        v.object({
          skills: v.array(v.string()),
          connectors: v.array(v.string()),
        }),
      ),
      codingResume: v.optional(v.string()),
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
    return {
      kind: thread.kind,
      capabilities: thread.capabilities,
      codingResume: thread.codingResume,
    };
  },
});

/** Remember the harness conversation handle a coding turn ended with. */
export const setCodingResumeInternal = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    codingResume: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const threadId = ctx.db.normalizeId('threads', args.threadId);
    if (!threadId) return null;
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.organizationId !== args.organizationId) return null;
    await ctx.db.patch(threadId, {
      codingResume: args.codingResume,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Start a new thread owned by the caller. */
export const createThread = mutation({
  args: {
    organizationId: v.string(),
    kind: chatKindValidator,
    title: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
    harness: v.optional(v.string()),
    capabilities: v.optional(
      v.object({
        skills: v.array(v.string()),
        connectors: v.array(v.string()),
      }),
    ),
    /** Start the conversation inside a project (the project's "New chat"
     * flow). A string because it arrives from a URL param; validated here. */
    projectId: v.optional(v.string()),
  },
  returns: v.id('threads'),
  handler: async (ctx, args) => {
    const userId = await requireOrgUser(ctx, args.organizationId);

    // A project link is access-checked at creation with the same gate the
    // chat send path uses — a thread must never smuggle a caller into a
    // project they cannot read.
    let projectId: Doc<'projects'>['_id'] | undefined;
    if (args.projectId !== undefined) {
      const normalized = ctx.db.normalizeId('projects', args.projectId);
      if (normalized === null) {
        throw new ConvexError({ code: 'PROJECT_NOT_FOUND' });
      }
      const access = await ctx.runQuery(
        internal.projects.internal_queries.assertProjectAccessForChat,
        {
          projectId: normalized,
          organizationId: args.organizationId,
          userId,
        },
      );
      if (!access.allowed) {
        throw new ConvexError({
          code:
            access.reason === 'not_found'
              ? 'PROJECT_NOT_FOUND'
              : 'PROJECT_FORBIDDEN',
        });
      }
      projectId = normalized;
    }

    const now = Date.now();
    return await ctx.db.insert('threads', {
      organizationId: args.organizationId,
      userId,
      kind: args.kind,
      title: args.title,
      agentSlug: args.agentSlug,
      harness: args.harness,
      capabilities: args.capabilities,
      ...(projectId !== undefined ? { projectId } : {}),
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * File a thread under a project, or take it back out (`projectId: null`).
 * The project link is access-checked with the same gate `createThread` uses —
 * filing must never smuggle a caller into a project they cannot read. Filing
 * is a metadata edit, not chat activity, so `updatedAt` stays untouched and
 * the list keeps its recency order. Returns false when the thread is not the
 * caller's, so a client can distinguish a no-op from a success.
 */
export const moveThreadToProject = mutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    projectId: v.union(v.string(), v.null()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await requireOrgUser(ctx, args.organizationId);
    const thread = await loadOwnedThread(
      ctx,
      args.organizationId,
      userId,
      args.threadId,
    );
    if (!thread) return false;

    if (args.projectId === null) {
      await ctx.db.patch(thread._id, { projectId: undefined });
      return true;
    }

    const normalized = ctx.db.normalizeId('projects', args.projectId);
    if (normalized === null) {
      throw new ConvexError({ code: 'PROJECT_NOT_FOUND' });
    }
    const access = await ctx.runQuery(
      internal.projects.internal_queries.assertProjectAccessForChat,
      {
        projectId: normalized,
        organizationId: args.organizationId,
        userId,
      },
    );
    if (!access.allowed) {
      throw new ConvexError({
        code:
          access.reason === 'not_found'
            ? 'PROJECT_NOT_FOUND'
            : 'PROJECT_FORBIDDEN',
      });
    }
    await ctx.db.patch(thread._id, { projectId: normalized });
    return true;
  },
});

/** Archive or unarchive a thread. Returns false when the thread is not the
 * caller's, so a client can distinguish a no-op from a success. */
export const setThreadArchived = mutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    archived: v.boolean(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await requireOrgUser(ctx, args.organizationId);
    const thread = await loadOwnedThread(
      ctx,
      args.organizationId,
      userId,
      args.threadId,
    );
    if (!thread) return false;
    await ctx.db.patch(thread._id, {
      archived: args.archived,
      updatedAt: Date.now(),
    });
    return true;
  },
});

/**
 * Share a thread with the rest of the organization: mint the token that IS the
 * share URL, and stamp `sharedAt` — the snapshot boundary the shared read
 * enforces. Re-sharing an already-shared thread keeps the token (the URL stays
 * stable) but refreshes `sharedAt`, so sharing again is how the owner
 * publishes the turns that happened since. Returns null when the thread is not
 * the caller's.
 */
export const shareThread = mutation({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.union(v.object({ shareToken: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const userId = await requireOrgUser(ctx, args.organizationId);
    const thread = await loadOwnedThread(
      ctx,
      args.organizationId,
      userId,
      args.threadId,
    );
    if (!thread) return null;

    const shareToken = thread.shareToken ?? mintShareToken();
    await ctx.db.patch(thread._id, {
      shareToken,
      isShared: true,
      sharedAt: Date.now(),
      sharedBy: userId,
    });
    return { shareToken };
  },
});

/**
 * Stop sharing a thread. The token is kept so re-sharing restores the same
 * URL; only `isShared` gates the read, so an unshared link goes dark
 * immediately.
 */
export const unshareThread = mutation({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireOrgUser(ctx, args.organizationId);
    const thread = await loadOwnedThread(
      ctx,
      args.organizationId,
      userId,
      args.threadId,
    );
    if (!thread) return null;
    await ctx.db.patch(thread._id, { isShared: false });
    return null;
  },
});

/**
 * Resolve a share token to its read-only snapshot. The token authorizes the
 * read TOGETHER with organization membership — sharing is org-internal, never
 * public — and the snapshot is cut at `sharedAt`: messages appended after the
 * share are not part of it. Returns null for an unknown token, an unshared
 * thread, or a caller outside the thread's organization; the three are
 * indistinguishable by design, so the token alone never confirms a thread
 * exists.
 */
export const getSharedThread = query({
  args: { shareToken: v.string() },
  returns: v.union(sharedThreadValidator, v.null()),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const thread = await ctx.db
      .query('threads')
      .withIndex('by_shareToken', (q) => q.eq('shareToken', args.shareToken))
      .first();
    if (
      !thread ||
      thread.isShared !== true ||
      thread.sharedAt === undefined ||
      thread.sharedBy === undefined
    ) {
      return null;
    }

    try {
      await getOrganizationMember(ctx, thread.organizationId, authUser);
    } catch {
      // A caller outside the thread's organization gets the same answer as an
      // unknown token — membership is the authorization, and its absence must
      // not read differently from the share not existing.
      return null;
    }

    const sharedAt = thread.sharedAt;
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_thread_sequence', (q) => q.eq('threadId', thread._id))
      .collect();

    return {
      threadId: thread._id,
      title: thread.title,
      sharedBy: thread.sharedBy,
      sharedAt,
      agentSlug: thread.agentSlug,
      // Only what existed when the share was (re)published — the share is a
      // snapshot in time, not a live feed of the conversation.
      messages: messages
        .filter((message) => message.createdAt <= sharedAt)
        .map((message) => ({
          id: message._id,
          role: message.role,
          parts: message.parts,
          sequence: message.sequence,
          model: message.model,
          providerSlug: message.providerSlug,
          blockedReason: message.blockedReason,
          error: message.error,
          createdAt: message.createdAt,
        })),
    };
  },
});

/**
 * Fork a thread at a message: create a new thread that carries the
 * conversation up to and including that message, and nothing after it. The
 * copy reassigns sequences from zero so the branch is a self-contained history
 * rather than one that shares row identity with its parent.
 */
export const branchThread = mutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    fromMessageId: v.string(),
  },
  returns: v.union(v.id('threads'), v.null()),
  handler: async (ctx, args) => {
    const userId = await requireOrgUser(ctx, args.organizationId);
    const thread = await loadOwnedThread(
      ctx,
      args.organizationId,
      userId,
      args.threadId,
    );
    if (!thread) return null;

    const fork = ctx.db.normalizeId('messages', args.fromMessageId);
    if (!fork) return null;
    const forkMessage = await ctx.db.get(fork);
    if (!forkMessage || forkMessage.threadId !== thread._id) return null;

    const now = Date.now();
    const branchId = await ctx.db.insert('threads', {
      organizationId: thread.organizationId,
      userId,
      kind: thread.kind,
      title: thread.title,
      agentSlug: thread.agentSlug,
      branchedFromMessageId: forkMessage._id,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });

    // Copy the history up to the fork point, in order, with fresh sequences.
    const history = await ctx.db
      .query('messages')
      .withIndex('by_thread_sequence', (q) => q.eq('threadId', thread._id))
      .collect();
    let sequence = 0;
    for (const message of history) {
      if (message.sequence > forkMessage.sequence) break;
      await ctx.db.insert('messages', {
        organizationId: message.organizationId,
        threadId: branchId,
        role: message.role,
        parts: message.parts,
        sequence,
        model: message.model,
        providerSlug: message.providerSlug,
        usage: message.usage,
        blockedReason: message.blockedReason,
        error: message.error,
        createdAt: now,
      });
      sequence += 1;
    }

    return branchId;
  },
});
