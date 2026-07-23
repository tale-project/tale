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

import { v } from 'convex/values';

import {
  classifyChatErrorCode,
  decodeChatError,
} from '../../lib/shared/chat-errors';
import { DAY_MS, dailyKeys, utcDateKey } from '../../lib/shared/metrics-window';
import { internalMutation, query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

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
    if (
      !thread ||
      thread.organizationId !== args.organizationId ||
      thread.userId !== authUser.userId
    ) {
      return [];
    }

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
      blockedReason: message.blockedReason,
      error: message.error,
      createdAt: message.createdAt,
    }));
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
  },
  returns: v.object({ id: v.id('messages'), sequence: v.number() }),
  handler: async (ctx, args) => {
    const threadId = ctx.db.normalizeId('threads', args.threadId);
    if (!threadId) {
      throw new Error(
        `[chat] cannot append to unknown thread ${args.threadId}`,
      );
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
      createdAt: Date.now(),
    });

    // A turn just wrote to the thread; keep its list ordering fresh.
    await ctx.db.patch(thread._id, { updatedAt: Date.now() });

    return { id, sequence };
  },
});
