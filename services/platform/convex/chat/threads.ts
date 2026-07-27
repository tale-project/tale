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
import { createAuditLog } from '../audit_logs/helpers';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { chatKindValidator } from './schema';

/** What the conversation equips its agent with — the shape
 * `threads.capabilities` stores, shared by every read and write of it here. */
const threadCapabilitiesValidator = v.object({
  skills: v.array(v.string()),
  connectors: v.array(v.string()),
});

/** One row of the thread list, already reduced to what the sub-panel renders. */
const threadSummaryValidator = v.object({
  id: v.id('threads'),
  title: v.optional(v.string()),
  kind: chatKindValidator,
  agentSlug: v.optional(v.string()),
  /** The external agent pinned to a sandbox thread (absent on direct threads). */
  harness: v.optional(v.string()),
  /** The conversation's capability assembly (the composer's Skills /
   * Connectors picks) — surfaced so the composer re-hydrates its menu from
   * the thread instead of resetting to empty on every remount. */
  capabilities: v.optional(threadCapabilitiesValidator),
  /** The project the thread is filed under (absent = the loose Chats list). */
  projectId: v.optional(v.id('projects')),
  archived: v.boolean(),
  pinnedAt: v.optional(v.number()),
  /** Unread tracking: newest assistant activity vs. the owner's watermark. */
  lastReplyAt: v.optional(v.number()),
  lastReadAt: v.optional(v.number()),
  isShared: v.optional(v.boolean()),
  createdAt: v.number(),
  updatedAt: v.number(),
  generating: v.boolean(),
});

/** The one projection from a thread row to its list summary — shared by every
 * read that returns summaries, so the shapes cannot drift apart. */
function toThreadSummary(
  thread: Doc<'threads'>,
  generating: boolean,
): {
  id: Doc<'threads'>['_id'];
  title?: string;
  kind: Doc<'threads'>['kind'];
  agentSlug?: string;
  harness?: string;
  capabilities?: { skills: string[]; connectors: string[] };
  projectId?: Doc<'projects'>['_id'];
  archived: boolean;
  pinnedAt?: number;
  lastReplyAt?: number;
  lastReadAt?: number;
  isShared?: boolean;
  createdAt: number;
  updatedAt: number;
  generating: boolean;
} {
  return {
    id: thread._id,
    title: thread.title,
    kind: thread.kind,
    agentSlug: thread.agentSlug,
    harness: thread.harness,
    capabilities: thread.capabilities,
    projectId: thread.projectId,
    archived: thread.archived,
    pinnedAt: thread.pinnedAt,
    lastReplyAt: thread.lastReplyAt,
    lastReadAt: thread.lastReadAt,
    isShared: thread.isShared,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    generating,
  };
}

/** A conversation may equip its agent with at most this many skills /
 * connectors — mirrors the project binding's `MAX_PROJECT_AGENT_*` ceilings;
 * a generous guard, not a curation limit. */
const MAX_THREAD_SKILLS = 25;
const MAX_THREAD_CONNECTORS = 25;

/** Normalize a capability assembly for storage: enforce the ceilings, dedupe,
 * drop empties (it is a set, not an ordered list), and collapse an
 * all-empty assembly to `undefined` so the thread falls back to its defaults
 * rather than pinning "nothing". Shared by `createThread` and
 * `setThreadCapabilities`, so both write paths accept exactly the same
 * shapes. */
function sanitizeThreadCapabilities(capabilities: {
  skills: string[];
  connectors: string[];
}): { skills: string[]; connectors: string[] } | undefined {
  if (
    capabilities.skills.length > MAX_THREAD_SKILLS ||
    capabilities.connectors.length > MAX_THREAD_CONNECTORS
  ) {
    throw new ConvexError({
      code: 'too_many_bindings',
      message: `A conversation may equip at most ${MAX_THREAD_SKILLS} skills and ${MAX_THREAD_CONNECTORS} connectors.`,
    });
  }
  const skills = [
    ...new Set(capabilities.skills.filter((slug) => slug.length > 0)),
  ];
  const connectors = [
    ...new Set(capabilities.connectors.filter((slug) => slug.length > 0)),
  ];
  if (skills.length === 0 && connectors.length === 0) return undefined;
  return { skills, connectors };
}

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
 * Returns null when it does not exist, is owned by someone else, or sits in
 * the trash lifecycle — a missing thread, a forbidden one, and a trashed one
 * are indistinguishable to a caller by design. The trash flows use their own
 * raw loads (`thread_lifecycle.ts`); everything else treats trash as gone. */
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
    thread.userId !== userId ||
    thread.lifecycleStatus !== undefined
  ) {
    return null;
  }
  return thread;
}

/**
 * List the caller's ACTIVE threads — live (no lifecycle status), visible (not
 * a hidden branch sibling), unarchived — newest activity first with pinned
 * rows floated on top, each tagged with whether a turn is currently
 * generating. The generating flag reads the `generations` table — whose row
 * exists exactly while a turn is in flight — rather than a column on the
 * thread, so a streaming turn never rewrites a row the list reads.
 *
 * Deliberately `collect()`, not paginated: the sub-panel buckets every row
 * into project folders and the loose list (grouping and drag-and-drop need
 * the full set), and the walk is index-pre-filtered to the active set only —
 * archived, trashed, and hidden branches, the unbounded growth vectors, never
 * enter it. A user's ACTIVE set is bounded by human behavior; the archived
 * list below is the one that grows monotonically, and it paginates.
 */
export const listThreads = query({
  args: { organizationId: v.string() },
  returns: v.array(threadSummaryValidator),
  handler: async (ctx, args) => {
    const userId = await requireOrgUser(ctx, args.organizationId);

    const threads = await ctx.db
      .query('threads')
      .withIndex('by_user_list', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('userId', userId)
          .eq('archived', false)
          .eq('lifecycleStatus', undefined)
          .eq('hidden', undefined),
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

    // Pinned rows first (newest pin on top), the rest in index (recency)
    // order — the server owns the ordering so no client re-sorts a page.
    const pinned = threads
      .filter((thread) => thread.pinnedAt !== undefined)
      .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
    const unpinned = threads.filter((thread) => thread.pinnedAt === undefined);

    return [...pinned, ...unpinned].map((thread) =>
      toThreadSummary(thread, generating.has(thread._id)),
    );
  },
});

/** One page size of the archived list. */
const ARCHIVED_PAGE_DEFAULT = 30;
const ARCHIVED_PAGE_MAX = 50;

/**
 * The caller's archived threads, newest first, one page at a time. Archived
 * chats grow without bound (archiving is the "get it out of the way" flow),
 * so unlike the active list this read paginates: `cursor` is the `updatedAt`
 * of the last row of the previous page, and a `null` `nextCursor` means the
 * end. A manual cursor rather than `.paginate` keeps the read a plain seam
 * watch (the session cache replays it like any other query).
 */
export const listArchivedThreads = query({
  args: {
    organizationId: v.string(),
    cursor: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    rows: v.array(threadSummaryValidator),
    nextCursor: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const userId = await requireOrgUser(ctx, args.organizationId);
    const limit = Math.min(
      Math.max(args.limit ?? ARCHIVED_PAGE_DEFAULT, 1),
      ARCHIVED_PAGE_MAX,
    );

    const cursor = args.cursor;
    const page = await ctx.db
      .query('threads')
      .withIndex('by_user_list', (q) => {
        const scoped = q
          .eq('organizationId', args.organizationId)
          .eq('userId', userId)
          .eq('archived', true)
          .eq('lifecycleStatus', undefined)
          .eq('hidden', undefined);
        return cursor === undefined ? scoped : scoped.lt('updatedAt', cursor);
      })
      .order('desc')
      .take(limit + 1);

    const rows = page.slice(0, limit);
    const nextCursor =
      page.length > limit ? (rows.at(-1)?.updatedAt ?? null) : null;

    return {
      // Nothing archived generates — a turn cannot be sent into an archived
      // thread — so the flag is constant false rather than a scan.
      rows: rows.map((thread) => toThreadSummary(thread, false)),
      nextCursor,
    };
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
    return toThreadSummary(thread, generation !== null);
  },
});

/** The thread facts an external turn reads, scoped like every other read —
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
      capabilities: v.optional(threadCapabilitiesValidator),
      externalResume: v.optional(v.string()),
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
      // The deprecated `codingResume` read shim lives HERE, so every
      // consumer sees only `externalResume`.
      externalResume: thread.externalResume ?? thread.codingResume,
    };
  },
});

/** Remember the harness conversation handle an external turn ended with. */
export const setExternalResumeInternal = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    externalResume: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const threadId = ctx.db.normalizeId('threads', args.threadId);
    if (!threadId) return null;
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.organizationId !== args.organizationId) return null;
    await ctx.db.patch(threadId, {
      externalResume: args.externalResume,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Set the AI-generated title on a thread that is still untitled. Written by
 * `generate_title.ts` only: the guard on an existing title makes the write
 * idempotent and keeps a slow generation from ever clobbering a title that
 * arrived by another path (a branch copy, a future rename). A title is
 * metadata, not chat activity, so `updatedAt` stays untouched and the list
 * keeps its recency order.
 */
export const setThreadTitleInternal = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    title: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const threadId = ctx.db.normalizeId('threads', args.threadId);
    if (!threadId) return null;
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.organizationId !== args.organizationId) return null;
    if (thread.title !== undefined) return null;
    const title = args.title.trim();
    if (title.length === 0) return null;
    await ctx.db.patch(threadId, { title });
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
    capabilities: v.optional(threadCapabilitiesValidator),
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
      capabilities:
        args.capabilities !== undefined
          ? sanitizeThreadCapabilities(args.capabilities)
          : undefined,
      ...(projectId !== undefined ? { projectId } : {}),
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Replace the conversation's capability assembly — the composer's Skills /
 * Connectors picks — for every turn that follows. Written on each toggle, so
 * a pick made mid-conversation outlives the message it was made for
 * (previously the assembly was frozen at `createThread`, which made
 * re-toggling in an existing thread a silent no-op). An assembly that ends up
 * empty clears the field, so the thread falls back to its project/agent
 * defaults rather than pinning "nothing". Editing the assembly is a metadata
 * edit, not chat activity, so `updatedAt` stays untouched and the list keeps
 * its recency order. Returns false when the thread is not the caller's, so a
 * client can distinguish a no-op from a success.
 */
export const setThreadCapabilities = mutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    capabilities: threadCapabilitiesValidator,
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
      capabilities: sanitizeThreadCapabilities(args.capabilities),
    });
    return true;
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

/** The header cap on a chat name — generous for a title, hostile to a pasted
 * essay. Mirrors the AI title generator's own ceiling. */
const MAX_THREAD_TITLE_CHARS = 120;

/**
 * Rename a thread. The owner's explicit name always wins — unlike the
 * AI-title path (`setThreadTitleInternal`), which only ever fills an empty
 * title. A rename is a metadata edit, not chat activity, so `updatedAt` stays
 * untouched and the list keeps its recency order. Returns false when the
 * thread is not the caller's or the name is empty after trimming.
 */
export const renameThread = mutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    title: v.string(),
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
    const title = args.title.trim().slice(0, MAX_THREAD_TITLE_CHARS);
    if (title.length === 0) return false;
    await ctx.db.patch(thread._id, { title });
    return true;
  },
});

/**
 * Pin or unpin a thread — pinned rows float to the top of the list, newest
 * pin first. A metadata edit, not chat activity: `updatedAt` stays untouched.
 * Returns false when the thread is not the caller's.
 */
export const setThreadPinned = mutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    pinned: v.boolean(),
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
      pinnedAt: args.pinned ? Date.now() : undefined,
    });
    return true;
  },
});

/**
 * Stamp the owner's read watermark — the unread dot clears the moment the
 * conversation is on screen. Best-effort by design: it runs on every thread
 * open, so a missing or foreign row is a silent no-op, never an error toast.
 */
export const markThreadRead = mutation({
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
    await ctx.db.patch(thread._id, { lastReadAt: Date.now() });
    return null;
  },
});

/**
 * Archive or unarchive a thread. Archiving is a metadata edit, not chat
 * activity — `updatedAt` stays untouched, so unarchiving returns the row to
 * its true recency slot instead of the top of the list. Audited: archives are
 * a governance-relevant lifecycle change. Returns false when the thread is
 * not the caller's, so a client can distinguish a no-op from a success.
 */
export const setThreadArchived = mutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    archived: v.boolean(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    await getOrganizationMember(ctx, args.organizationId, authUser);
    const thread = await loadOwnedThread(
      ctx,
      args.organizationId,
      authUser.userId,
      args.threadId,
    );
    if (!thread) return false;
    if (thread.archived === args.archived) return true;
    await ctx.db.patch(thread._id, { archived: args.archived });
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: authUser.userId,
      actorEmail: authUser.email,
      actorType: 'user',
      action: args.archived ? 'chat_thread.archived' : 'chat_thread.unarchived',
      category: 'data',
      resourceType: 'thread',
      resourceId: String(thread._id),
      resourceName: thread.title,
      status: 'success',
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
