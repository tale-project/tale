/**
 * Messages — the ordered record of one thread's turns.
 *
 * A message carries an ordered list of parts (text, attachments, tool calls
 * and their results, approval and human-input cards) exactly as authored,
 * because the context contract replays a conversation whole rather than
 * summarizing it. Reading a thread therefore reproduces precisely what the
 * model saw.
 *
 * `sequence` is the ordering key, and it is assigned INSIDE the append
 * transaction as one more than the current maximum for the thread. Convex
 * serializes mutations, so two turns that append at the same instant each see
 * the other's committed row and take the next number — the ordering never
 * depends on a wall-clock tie, and the sequence is gap-free and monotonic.
 *
 * The append is an internal mutation because it is the trusted lower half of a
 * turn: the node action that drives a turn authenticates the caller and
 * resolves the organization before it ever writes a message, so this function
 * takes the already-verified organization and thread and does not re-check
 * identity.
 */

import { ConvexError, v } from 'convex/values';

import {
  classifyChatErrorCode,
  decodeChatError,
} from '../../lib/shared/chat-errors';
import { DAY_MS, dailyKeys, utcDateKey } from '../../lib/shared/metrics-window';
import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { OrganizationMismatchError } from '../lib/rls/errors';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { loadProjectSharedThread } from './threads';

const MAX_PERCEIVED_WAIT_MS = 30 * 60 * 1000;

const messageRoleValidator = v.union(
  v.literal('user'),
  v.literal('assistant'),
  v.literal('tool'),
  v.literal('system'),
);

/** One rendered message. Parts and usage are shaped by the chat layer rather
 * than re-declared here, so adding a part kind is not a schema change. */
const messageViewValidator = v.object({
  id: v.id('messages'),
  role: messageRoleValidator,
  parts: v.any(),
  sequence: v.number(),
  model: v.optional(v.string()),
  providerSlug: v.optional(v.string()),
  /** Token counts and turn timings, as the pipeline stamped them — the
   * message-info panel's source. Shaped by the chat layer (`TurnUsage`). */
  usage: v.optional(v.any()),
  blockedReason: v.optional(v.string()),
  error: v.optional(v.string()),
  createdAt: v.number(),
});

/**
 * A thread's messages in sequence order. Returns an empty list when the thread
 * is not the caller's — a member never reads another member's conversation,
 * and no organization reads another's, because the thread ownership is
 * asserted before a single message row is loaded.
 */
export const listMessages = query({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.array(messageViewValidator),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    await getOrganizationMember(ctx, args.organizationId, authUser);

    const threadId = ctx.db.normalizeId('threads', args.threadId);
    if (!threadId) return [];
    const thread = await ctx.db.get(threadId);
    const owned =
      thread !== null &&
      thread.organizationId === args.organizationId &&
      thread.userId === authUser.userId &&
      // Trashed reads as gone — restore is the only way back.
      thread.lifecycleStatus === undefined;
    if (!owned) {
      // The one read-grant beside share links: a project member may read a
      // conversation its owner shared with the project (never write it).
      const shared = await loadProjectSharedThread(
        ctx,
        args.organizationId,
        authUser.userId,
        args.threadId,
      );
      if (!shared) return [];
    }
    if (!thread) return [];

    const messages = await ctx.db
      .query('messages')
      .withIndex('by_thread_sequence', (q) => q.eq('threadId', thread._id))
      .collect();

    return messages.map((message) => ({
      id: message._id,
      role: message.role,
      parts: message.parts,
      sequence: message.sequence,
      model: message.model,
      providerSlug: message.providerSlug,
      usage: message.usage,
      blockedReason: message.blockedReason,
      error: message.error,
      createdAt: message.createdAt,
    }));
  },
});

/**
 * The turn's bounded history read: newest-first up to a character budget and
 * a hard row cap, returned oldest-first. `omittedCount` is exactly the oldest
 * returned row's sequence — sequences are gap-free from 0, so everything
 * below it was left behind. Internal and identity-free: the API-key lane
 * schedules turns with no session, and history loading must not depend on
 * one (the caller has already authorized the thread).
 */
export const listRecentForTurnInternal = internalQuery({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    /** Stop once this many characters of parts are accumulated. */
    maxChars: v.number(),
    maxRows: v.number(),
  },
  returns: v.object({
    messages: v.array(messageViewValidator),
    omittedCount: v.number(),
    /** The conversation's equipped skill slugs — the direct lane injects
     * their instructions into the turn's context. */
    equippedSkills: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const threadId = ctx.db.normalizeId('threads', args.threadId);
    if (!threadId) return { messages: [], omittedCount: 0, equippedSkills: [] };
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.organizationId !== args.organizationId) {
      return { messages: [], omittedCount: 0, equippedSkills: [] };
    }

    const recent = [];
    let chars = 0;
    for await (const message of ctx.db
      .query('messages')
      .withIndex('by_thread_sequence', (q) => q.eq('threadId', thread._id))
      .order('desc')) {
      recent.push(message);
      chars += JSON.stringify(message.parts).length;
      if (recent.length >= args.maxRows || chars >= args.maxChars) break;
    }
    recent.reverse();
    return {
      messages: recent.map((message) => ({
        id: message._id,
        role: message.role,
        parts: message.parts,
        sequence: message.sequence,
        model: message.model,
        providerSlug: message.providerSlug,
        usage: message.usage,
        blockedReason: message.blockedReason,
        error: message.error,
        createdAt: message.createdAt,
      })),
      omittedCount: recent[0]?.sequence ?? 0,
      equippedSkills: thread.capabilities?.skills ?? [],
    };
  },
});

/** Cap on the chat-health scan — beyond it the figures report `capped: true`. */
const CHAT_HEALTH_MAX_SCAN = 5000;
const CHAT_HEALTH_TOP_N = 10;
const CHAT_HEALTH_RECENT_ERRORS = 20;

/** Turns on a thread with no agent bucket under this sentinel — the client
 * re-declares it (as the old chat-health page did) rather than importing a
 * runtime value across the convex boundary. */
const UNATTRIBUTED_AGENT_SLUG = '__unattributed__';

const breakdownEntryValidator = v.object({
  key: v.string(),
  count: v.number(),
});

const orgChatHealthValidator = v.object({
  summary: v.object({
    totalTurns: v.number(),
    errorCount: v.number(),
    /** 0–1 fraction of turns that errored (0 when the window has no turns). */
    errorRate: v.number(),
    blockedCount: v.number(),
    /** 0–1 fraction of turns a guardrail blocked. */
    blockedRate: v.number(),
    tokens: v.object({
      input: v.number(),
      output: v.number(),
      total: v.number(),
    }),
    capped: v.boolean(),
    /** Whether the organization has ANY messages at all — distinguishes a
     * never-used org (teaching panel) from an empty window. */
    hasAnyData: v.boolean(),
  }),
  series: v.array(
    v.object({
      dateKey: v.string(),
      turns: v.number(),
      errors: v.number(),
      blocked: v.number(),
    }),
  ),
  byModel: v.array(
    v.object({
      provider: v.string(),
      model: v.string(),
      count: v.number(),
    }),
  ),
  byAgent: v.array(
    v.object({
      agentSlug: v.string(),
      count: v.number(),
    }),
  ),
  errorsByType: v.array(breakdownEntryValidator),
  recentErrors: v.array(
    v.object({
      at: v.number(),
      type: v.string(),
      model: v.optional(v.string()),
      agentSlug: v.optional(v.string()),
    }),
  ),
});

/** Token counts from the message's `usage` blob. The blob is `v.any()` shaped
 * by the chat layer, so read it defensively rather than trusting the shape. */
function readTokenUsage(usage: unknown): {
  input: number;
  output: number;
  total: number;
} {
  if (usage === null || typeof usage !== 'object') {
    return { input: 0, output: 0, total: 0 };
  }
  const input =
    'inputTokens' in usage && typeof usage.inputTokens === 'number'
      ? usage.inputTokens
      : 0;
  const output =
    'outputTokens' in usage && typeof usage.outputTokens === 'number'
      ? usage.outputTokens
      : 0;
  const total =
    'totalTokens' in usage && typeof usage.totalTokens === 'number'
      ? usage.totalTokens
      : input + output;
  return { input, output, total };
}

/** Decode the structured error envelope when present; otherwise classify the
 * raw provider text — the graceful-degradation contract of `chat-errors.ts`. */
function classifyStoredChatError(error: string): string {
  const decoded = decodeChatError(error);
  return decoded.code ?? classifyChatErrorCode(decoded.raw ?? error);
}

/**
 * Org-wide chat health for the metrics page: turn/error/blocked totals, token
 * spend, a per-day series, model/agent breakdowns, and the newest errors. One
 * bounded newest-first walk over `messages` serves all of it; only assistant
 * rows count as turns (user/tool/system rows are the turn's inputs, not its
 * outcome).
 *
 * Admin-only, like every other org-wide metrics read.
 */
export const getOrgChatHealth = query({
  args: {
    organizationId: v.string(),
    periodDays: v.union(v.literal(1), v.literal(7), v.literal(30)),
  },
  returns: orgChatHealthValidator,
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );
    if (!isAdmin(member.role)) {
      throw new Error('Only admins can view chat health metrics');
    }

    const now = Date.now();
    const windowStart = now - args.periodDays * DAY_MS;

    let totalTurns = 0;
    let errorCount = 0;
    let blockedCount = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;

    const seriesMap = new Map(
      dailyKeys(args.periodDays, now).map((dateKey) => [
        dateKey,
        { dateKey, turns: 0, errors: 0, blocked: 0 },
      ]),
    );
    const modelCounts = new Map<
      string,
      { provider: string; model: string; count: number }
    >();
    /** Turn count per thread — agent attribution resolves after the walk. */
    const threadTurns = new Map<string, number>();
    const errorTypeCounts = new Map<string, number>();
    const recentErrors: Array<{
      at: number;
      type: string;
      model?: string;
      threadId: string;
    }> = [];

    let sawAnyRow = false;
    let scanned = 0;
    let capped = false;
    for await (const message of ctx.db
      .query('messages')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .order('desc')) {
      sawAnyRow = true;
      // `createdAt` is `Date.now()` at insert, so it decreases monotonically
      // along this newest-first walk — the first out-of-window row ends the
      // scan, bounding it to in-window rows.
      if (message.createdAt < windowStart) break;
      scanned++;
      if (scanned > CHAT_HEALTH_MAX_SCAN) {
        capped = true;
        break;
      }
      if (message.role !== 'assistant') continue;

      totalTurns++;
      const seriesPoint = seriesMap.get(utcDateKey(message.createdAt));
      if (seriesPoint) seriesPoint.turns++;

      const usage = readTokenUsage(message.usage);
      inputTokens += usage.input;
      outputTokens += usage.output;
      totalTokens += usage.total;

      threadTurns.set(
        message.threadId,
        (threadTurns.get(message.threadId) ?? 0) + 1,
      );

      if (message.model !== undefined) {
        const provider = message.providerSlug ?? '';
        const key = `${provider} ${message.model}`;
        const entry = modelCounts.get(key);
        if (entry) entry.count++;
        else modelCounts.set(key, { provider, model: message.model, count: 1 });
      }

      if (message.blockedReason !== undefined) {
        blockedCount++;
        if (seriesPoint) seriesPoint.blocked++;
      }

      if (message.error !== undefined) {
        errorCount++;
        if (seriesPoint) seriesPoint.errors++;
        const type = classifyStoredChatError(message.error);
        errorTypeCounts.set(type, (errorTypeCounts.get(type) ?? 0) + 1);
        // The walk is newest-first, so the first N errors ARE the newest N.
        if (recentErrors.length < CHAT_HEALTH_RECENT_ERRORS) {
          recentErrors.push({
            at: message.createdAt,
            type,
            ...(message.model !== undefined && { model: message.model }),
            threadId: message.threadId,
          });
        }
      }
    }

    // Resolve each seen thread's agent attribution in one bounded pass — the
    // distinct-thread count is at most the scanned row count.
    const agentByThread = new Map<string, string>();
    for (const threadId of threadTurns.keys()) {
      const id = ctx.db.normalizeId('threads', threadId);
      const thread = id ? await ctx.db.get(id) : null;
      agentByThread.set(threadId, thread?.agentSlug ?? UNATTRIBUTED_AGENT_SLUG);
    }
    const agentCounts = new Map<string, number>();
    for (const [threadId, count] of threadTurns) {
      const slug = agentByThread.get(threadId) ?? UNATTRIBUTED_AGENT_SLUG;
      agentCounts.set(slug, (agentCounts.get(slug) ?? 0) + count);
    }

    return {
      summary: {
        totalTurns,
        errorCount,
        errorRate: totalTurns > 0 ? errorCount / totalTurns : 0,
        blockedCount,
        blockedRate: totalTurns > 0 ? blockedCount / totalTurns : 0,
        tokens: {
          input: inputTokens,
          output: outputTokens,
          total: totalTokens,
        },
        capped,
        hasAnyData: sawAnyRow,
      },
      series: [...seriesMap.values()],
      byModel: [...modelCounts.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, CHAT_HEALTH_TOP_N),
      byAgent: [...agentCounts]
        .map(([agentSlug, count]) => ({ agentSlug, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, CHAT_HEALTH_TOP_N),
      errorsByType: [...errorTypeCounts]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count),
      recentErrors: recentErrors.map((entry) => {
        const agentSlug = agentByThread.get(entry.threadId);
        const out: {
          at: number;
          type: string;
          model?: string;
          agentSlug?: string;
        } = { at: entry.at, type: entry.type };
        if (entry.model !== undefined) out.model = entry.model;
        if (agentSlug !== undefined && agentSlug !== UNATTRIBUTED_AGENT_SLUG) {
          out.agentSlug = agentSlug;
        }
        return out;
      }),
    };
  },
});

/**
 * Append one message to a thread, assigning the next sequence within the
 * transaction. Returns the new id and the assigned sequence so the caller can
 * refer to the row it just wrote.
 */
export const appendMessageInternal = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    role: messageRoleValidator,
    parts: v.any(),
    model: v.optional(v.string()),
    providerSlug: v.optional(v.string()),
    usage: v.optional(v.any()),
    blockedReason: v.optional(v.string()),
    /** A hard failure (provider error, timeout) — distinct from a guardrail
     * `blockedReason`. Rendered as an error state and counted as an error (not
     * a block) by the chat-health metrics. */
    error: v.optional(v.string()),
    /** Silent stamp: context assembly dropped older history for this turn. */
    truncation: v.optional(v.object({ droppedMessages: v.number() })),
  },
  returns: v.object({ id: v.id('messages'), sequence: v.number() }),
  handler: async (ctx, args) => appendMessageToThread(ctx, args),
});

/** One append's arguments, as `appendMessageInternal` accepts them. */
interface AppendMessageArgs {
  organizationId: string;
  threadId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  parts: unknown;
  model?: string;
  providerSlug?: string;
  usage?: unknown;
  blockedReason?: string;
  error?: string;
  truncation?: { droppedMessages: number };
}

/**
 * The append transaction body, shared between `appendMessageInternal` and the
 * merged turn-open write (`turn_setup.beginTurnInternal`) so the two paths
 * cannot drift: sequence assignment, thread/branch-root freshness stamps, and
 * the first-message title schedule all live here and only here.
 */
export async function appendMessageToThread(
  ctx: MutationCtx,
  args: AppendMessageArgs,
): Promise<{ id: Id<'messages'>; sequence: number }> {
  const threadId = ctx.db.normalizeId('threads', args.threadId);
  if (!threadId) {
    throw new Error(`[chat] cannot append to unknown thread ${args.threadId}`);
  }
  const thread = await ctx.db.get(threadId);
  if (!thread || thread.organizationId !== args.organizationId) {
    throw new Error(
      `[chat] thread ${args.threadId} is not in organization ${args.organizationId}`,
    );
  }

  // The highest existing sequence for this thread, read inside the same
  // transaction as the insert so the assignment is atomic.
  const last = await ctx.db
    .query('messages')
    .withIndex('by_thread_sequence', (q) => q.eq('threadId', thread._id))
    .order('desc')
    .first();
  const sequence = last ? last.sequence + 1 : 0;

  const id = await ctx.db.insert('messages', {
    organizationId: args.organizationId,
    threadId: thread._id,
    role: args.role,
    parts: args.parts,
    sequence,
    model: args.model,
    providerSlug: args.providerSlug,
    usage: args.usage,
    blockedReason: args.blockedReason,
    error: args.error,
    createdAt: Date.now(),
    ...(args.truncation !== undefined ? { truncation: args.truncation } : {}),
  });

  // A turn just wrote to the thread; keep its list ordering fresh. An
  // assistant row also stamps the unread watermark — the sidebar's "new
  // response" dot compares it against the owner's `lastReadAt`.
  await ctx.db.patch(thread._id, {
    updatedAt: Date.now(),
    ...(args.role === 'assistant' ? { lastReplyAt: Date.now() } : {}),
  });
  // Activity on a hidden branch surfaces on its ROOT — the row the sidebar
  // actually shows for the lineage.
  if (thread.branchRootId !== undefined) {
    const rootId = ctx.db.normalizeId('threads', thread.branchRootId);
    const root = rootId ? await ctx.db.get(rootId) : null;
    if (root && root.organizationId === args.organizationId) {
      await ctx.db.patch(root._id, {
        updatedAt: Date.now(),
        ...(args.role === 'assistant' ? { lastReplyAt: Date.now() } : {}),
      });
    }
  }

  // The thread's first user message names the conversation: fire the AI
  // title generation exactly once — for the opening user message of a
  // thread that has no title yet (a branch copy or an explicitly titled
  // thread keeps what it has). Scheduled inside this transaction, so the
  // job exists iff the message committed.
  if (args.role === 'user' && sequence === 0 && thread.title === undefined) {
    const firstMessage = textOfParts(args.parts);
    if (firstMessage.trim().length > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.chat.generate_title.generateThreadTitle,
        {
          organizationId: args.organizationId,
          threadId: thread._id,
          userId: thread.userId,
          firstMessage,
        },
      );
    }
  }

  return { id, sequence };
}

/** A message's accumulated text — the user text a title is generated from,
 * and the assistant text a streaming window replaces. Kept tiny so the
 * read-modify-write a streaming window does stays cheap. */
function textOfParts(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  let out = '';
  for (const part of parts) {
    if (
      part !== null &&
      typeof part === 'object' &&
      'type' in part &&
      part.type === 'text' &&
      'text' in part &&
      typeof part.text === 'string'
    ) {
      out += part.text;
    }
  }
  return out;
}

/**
 * Persist a streaming turn's settled parts-so-far — the text segments, tool
 * calls, and tool results earlier rounds of the tool loop produced. The
 * caller sends the AUTHORITATIVE ordered list each time (idempotent, a few
 * writes per turn at most), so a crash keeps everything already settled.
 */
export const updateAssistantPartsInternal = internalMutation({
  args: {
    organizationId: v.string(),
    messageId: v.string(),
    parts: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const messageId = ctx.db.normalizeId('messages', args.messageId);
    if (!messageId) return null;
    const message = await ctx.db.get(messageId);
    if (!message || message.organizationId !== args.organizationId) {
      return null;
    }
    await ctx.db.patch(messageId, { parts: args.parts });
    return null;
  },
});

/**
 * Settle a turn's assistant message.
 *
 * Three callers, three shapes: the DIRECT turn pipeline passes the complete
 * ordered `parts` (tool calls and results included) — authoritative, written
 * verbatim; the external lane passes `finalText` when the harness gave one;
 * a failure path passes neither, and whatever parts the row already carries
 * (settled tool rounds, streamed partials) are PRESERVED, with the streamed
 * generation text rescued as the trailing text part when the row has none.
 */
export const finalizeAssistantMessageInternal = internalMutation({
  args: {
    organizationId: v.string(),
    // A plain string, normalized here — see `setAssistantTextInternal`.
    messageId: v.string(),
    finalText: v.optional(v.string()),
    /** The model's reasoning ("thinking"), settled as a display-only part. */
    reasoning: v.optional(v.string()),
    /** The complete ordered parts of the settled message. Authoritative when
     * present; `finalText`/`reasoning` are ignored for content then. */
    parts: v.optional(v.any()),
    model: v.optional(v.string()),
    providerSlug: v.optional(v.string()),
    usage: v.optional(v.any()),
    blockedReason: v.optional(v.string()),
    /** A hard failure — the turn threw mid-stream. The message keeps whatever
     * partial text streamed in and renders the error alongside it. */
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const messageId = ctx.db.normalizeId('messages', args.messageId);
    if (!messageId) return null;
    const message = await ctx.db.get(messageId);
    if (!message || message.organizationId !== args.organizationId) return null;

    let parts: unknown;
    if (args.parts !== undefined) {
      parts = args.parts;
    } else {
      let text =
        args.finalText !== undefined && args.finalText !== ''
          ? args.finalText
          : textOfParts(message.parts);
      let reasoning = args.reasoning ?? '';
      if (text === '') {
        // A mid-stream failure finalizes without text and the message row may
        // never have carried any (streaming writes land on the generation
        // row) — rescue the streamed partial from there. The generation still
        // exists at this point: the turn deletes it only after this settle.
        const threadId = ctx.db.normalizeId('threads', message.threadId);
        if (threadId) {
          const generation = await ctx.db
            .query('generations')
            .withIndex('by_thread', (q) => q.eq('threadId', threadId))
            .first();
          if (
            generation &&
            generation.organizationId === args.organizationId &&
            generation.messageId === args.messageId
          ) {
            text = generation.streamText ?? '';
            if (reasoning === '') reasoning = generation.streamReasoning ?? '';
          }
        }
      }
      // Preserve everything that is not the text/reasoning being settled —
      // the tool calls and results of rounds that already ran must survive a
      // failure finalize.
      const preserved = Array.isArray(message.parts)
        ? message.parts.filter(
            (part: unknown) =>
              part !== null &&
              typeof part === 'object' &&
              'type' in part &&
              part.type !== 'text' &&
              part.type !== 'reasoning',
          )
        : [];
      parts = [
        ...preserved,
        ...(reasoning !== '' ? [{ type: 'reasoning', text: reasoning }] : []),
        { type: 'text', text },
      ];
    }

    await ctx.db.patch(messageId, {
      parts,
      ...(args.model !== undefined ? { model: args.model } : {}),
      ...(args.providerSlug !== undefined
        ? { providerSlug: args.providerSlug }
        : {}),
      ...(args.usage !== undefined
        ? {
            usage: {
              ...(isRecord(message.usage) ? message.usage : {}),
              ...(isRecord(args.usage) ? args.usage : {}),
            },
          }
        : {}),
      ...(args.blockedReason !== undefined
        ? { blockedReason: args.blockedReason }
        : {}),
      ...(args.error !== undefined ? { error: args.error } : {}),
    });
    // The settle is the "reply arrived" moment for the unread dot — the
    // placeholder append stamped the turn's start; this refreshes it to when
    // the answer actually finished.
    const threadId = ctx.db.normalizeId('threads', message.threadId);
    if (threadId) {
      const thread = await ctx.db.get(threadId);
      if (thread && thread.organizationId === args.organizationId) {
        await ctx.db.patch(threadId, { lastReplyAt: Date.now() });
      }
    }
    return null;
  },
});

/**
 * Stamp the watching browser's "You waited" duration on an assistant row.
 * First-write-wins; a duration, never a pair of timestamps. Owner-only —
 * the same gate as rating a reply.
 */
export const reportPerceivedWait = mutation({
  args: {
    organizationId: v.string(),
    messageId: v.string(),
    perceivedWaitMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    await getOrganizationMember(ctx, args.organizationId);

    const wait = args.perceivedWaitMs;
    if (!Number.isFinite(wait) || wait <= 0 || wait > MAX_PERCEIVED_WAIT_MS) {
      return null;
    }

    const messageId = ctx.db.normalizeId('messages', args.messageId);
    const message = messageId ? await ctx.db.get(messageId) : null;
    if (!message || message.role !== 'assistant') {
      throw new ConvexError({
        code: 'not_found',
        message: 'Only an assistant reply of this conversation can be timed.',
      });
    }
    if (message.organizationId !== args.organizationId) {
      throw new OrganizationMismatchError();
    }

    const threadId = ctx.db.normalizeId('threads', message.threadId);
    const thread = threadId ? await ctx.db.get(threadId) : null;
    if (!thread || thread.userId !== authUser.userId) {
      throw new ConvexError({
        code: 'not_found',
        message: 'This conversation does not exist.',
      });
    }
    if (thread.organizationId !== args.organizationId) {
      throw new OrganizationMismatchError();
    }

    const existing = isRecord(message.usage) ? message.usage : {};
    if (typeof existing.perceivedWaitMs === 'number') return null;

    await ctx.db.patch(message._id, {
      usage: { ...existing, perceivedWaitMs: wait },
    });
    return null;
  },
});
