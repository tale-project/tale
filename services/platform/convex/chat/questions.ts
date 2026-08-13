/**
 * Pending clarifying questions for a chat thread.
 *
 * The turn settles when the assistant asks something (see
 * `PAUSING_CHAT_TOOLS`), so while an answer is outstanding there is no
 * generation row to hang the state on — the question lives here, on an
 * `approvals` row of type `human_input_request`, which is exactly what that
 * resource type and the `by_threadId_status_resourceType` index were cut for.
 *
 * One question set per thread at a time. A second call supersedes the first
 * rather than stacking: two panels competing for one composer is not a state
 * the surface can present, and the newer question is always the live one.
 *
 * The ANSWER is not handled here. It becomes the person's next message and
 * runs through `startTurn` like anything else they send — no hidden system
 * message, no second resume path, and the thread reads as the conversation it
 * is. All this module does is close the row so the panel clears.
 */

import { v } from 'convex/values';

import {
  questionSetSchema,
  type QuestionSet,
} from '../../lib/shared/schemas/questions';
import { isRecord } from '../../lib/utils/type-utils';
import type { Id } from '../_generated/dataModel';
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

/** The resource type the row is filed under. */
const RESOURCE_TYPE = 'human_input_request' as const;

/**
 * How far back to look for the assistant message that asked.
 *
 * The approvals row carries no `messageId`: the tool runs while the pipeline
 * is still streaming into a placeholder, so the id does not exist yet when the
 * row is written. The part is found by walking back from the newest message
 * instead — safe because a pending question OCCUPIES THE COMPOSER, so it can
 * only ever be a handful of messages old. Bounded so answering one question
 * can never turn into a full-thread read.
 */
const ASK_SCAN_LIMIT = 20;

/**
 * How many of a thread's newest messages decide whether it has moved past its
 * pending question. Bounded for the same reason as {@link ASK_SCAN_LIMIT}: a
 * question blocks the composer, so anything said after it is necessarily
 * among the newest few, and a live subscription must never grow into a
 * full-thread read.
 */
const SETTLED_SCAN_LIMIT = 20;

/**
 * Record on the transcript how the question ended.
 *
 * Without this the row's badge read "Your answer is needed" for the rest of
 * the thread's life: it derived "answered" from an `answer` field that nothing
 * ever filled in. The part is the only lasting trace of the ask — the panel
 * disappears — so it has to carry the outcome, not just the question.
 *
 * Best-effort. A resolved question whose transcript row could not be found is
 * still resolved; the row simply keeps its neutral state, which is a cosmetic
 * loss and never a reason to fail the answer.
 */
async function stampOutcome(
  ctx: MutationCtx,
  threadId: string,
  requestId: string,
  outcome: 'answered' | 'skipped',
): Promise<void> {
  const recent = await ctx.db
    .query('messages')
    .withIndex('by_thread_sequence', (q) => q.eq('threadId', threadId))
    .order('desc')
    .take(ASK_SCAN_LIMIT);

  for (const message of recent) {
    if (!Array.isArray(message.parts)) continue;
    let found = false;
    const parts = message.parts.map((part: unknown) => {
      if (
        isRecord(part) &&
        part.type === 'human-input' &&
        part.requestId === requestId
      ) {
        found = true;
        return { ...part, outcome };
      }
      return part;
    });
    if (found) {
      await ctx.db.patch(message._id, { parts });
      return;
    }
  }
  console.warn(
    `[chat] no human-input part found for ${requestId}; transcript row keeps its neutral state`,
  );
}

/**
 * True when this caller owns the chat thread — the chat domain's own gate,
 * the same one `listMessages` applies.
 *
 * NOT `canAccessThread`: that reads `threadMetadata`, a table the rewritten
 * chat pipeline never writes (only tasks and the test seeds do). It therefore
 * returns null for EVERY chat thread, so gating on it did not restrict
 * access — it silently denied all of it, and the question panel could never
 * render no matter how correct the row was.
 *
 * Owner-only on purpose: a project member may READ a shared conversation, but
 * answering a question in it would put words in the owner's mouth.
 */
async function ownsThread(
  ctx: QueryCtx,
  organizationId: string,
  threadId: string,
  userId: string,
): Promise<boolean> {
  const id = ctx.db.normalizeId('threads', threadId);
  if (!id) return false;
  const thread = await ctx.db.get(id);
  return (
    thread !== null &&
    thread.organizationId === organizationId &&
    thread.userId === userId &&
    // Trashed reads as gone.
    thread.lifecycleStatus === undefined
  );
}

/**
 * Register a question set for a thread and return the row it landed on. The
 * id rides back to the model's tool result and onto the transcript's
 * `human-input` part, so every later read finds the same row.
 */
export const createQuestionRequestInternal = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    messageId: v.optional(v.string()),
    /** Already validated against `questionSetSchema` by the caller; stored
     *  verbatim so the panel renders what the model actually asked. */
    set: v.any(),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    // Supersede anything still open on this thread — the composer shows one
    // panel, so a stale pending row would fight the new one for it.
    const open = await ctx.db
      .query('approvals')
      .withIndex('by_threadId_status_resourceType', (q) =>
        q
          .eq('threadId', args.threadId)
          .eq('status', 'pending')
          .eq('resourceType', RESOURCE_TYPE),
      )
      .collect();
    for (const row of open) {
      await ctx.db.patch(row._id, {
        status: 'rejected',
        reviewedAt: Date.now(),
      });
    }

    const id = await ctx.db.insert('approvals', {
      organizationId: args.organizationId,
      status: 'pending',
      resourceType: RESOURCE_TYPE,
      resourceId: args.threadId,
      threadId: args.threadId,
      ...(args.messageId !== undefined ? { messageId: args.messageId } : {}),
      priority: 'medium',
      metadata: { set: args.set, requestedAt: Date.now() },
    });
    return id;
  },
});

/** The pending question set for a thread, or null. The composer watches this. */
export const getPendingQuestion = query({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.union(
    v.null(),
    v.object({ requestId: v.id('approvals'), set: v.any() }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<{ requestId: Id<'approvals'>; set: QuestionSet } | null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;
    // The question belongs to whoever the thread belongs to; a reader who
    // cannot open the thread must not learn what it was asked.
    const owned = await ownsThread(
      ctx,
      args.organizationId,
      args.threadId,
      authUser.userId,
    );
    if (!owned) return null;

    const row = await ctx.db
      .query('approvals')
      .withIndex('by_threadId_status_resourceType', (q) =>
        q
          .eq('threadId', args.threadId)
          .eq('status', 'pending')
          .eq('resourceType', RESOURCE_TYPE),
      )
      .first();
    if (!row || row.organizationId !== args.organizationId) return null;

    // A question is outstanding only while the conversation has NOT moved
    // past it. Anything the person has said since — the answer itself, or a
    // change of subject — settles it, and that is a fact the thread already
    // carries. Deriving it costs one bounded read and cannot go wrong.
    //
    // Depending on a separate write to close the row could, and did: a
    // rejected `resolveQuestion` left the question offered forever, above the
    // reply to the very answers that were supposed to close it. Suppressing
    // it on the client instead only held until the next reload, because that
    // state lives in a component. The write still runs — it stamps the
    // transcript and tidies the row — but nothing the person SEES depends on
    // it landing any more.
    const requestedAt =
      isRecord(row.metadata) && typeof row.metadata.requestedAt === 'number'
        ? row.metadata.requestedAt
        : row._creationTime;
    const recent = await ctx.db
      .query('messages')
      .withIndex('by_thread_sequence', (q) => q.eq('threadId', args.threadId))
      .order('desc')
      .take(SETTLED_SCAN_LIMIT);
    const movedOn = recent.some(
      (message) => message.role === 'user' && message.createdAt > requestedAt,
    );
    if (movedOn) return null;

    // A row whose stored set no longer parses is a row nothing can render —
    // report it as absent rather than handing the panel a shape it will
    // crash on.
    const parsed = questionSetSchema.safeParse(
      isRecord(row.metadata) ? row.metadata.set : undefined,
    );
    if (!parsed.success) {
      console.warn(
        `[chat] pending question ${row._id} has an unreadable set; hiding it`,
      );
      return null;
    }
    return { requestId: row._id, set: parsed.data };
  },
});

/**
 * Close a pending question. Called when the person answers (their answer then
 * goes through `startTurn` as their next message) and when they decide to say
 * something else instead — a typed message supersedes the question rather
 * than leaving the thread deadlocked on it.
 */
export const resolveQuestion = mutation({
  args: {
    organizationId: v.string(),
    requestId: v.id('approvals'),
    outcome: v.union(v.literal('answered'), v.literal('superseded')),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;
    const row = await ctx.db.get(args.requestId);
    if (
      !row ||
      row.organizationId !== args.organizationId ||
      row.resourceType !== RESOURCE_TYPE
    ) {
      return null;
    }
    if (row.threadId === undefined) return null;
    const owned = await ownsThread(
      ctx,
      args.organizationId,
      row.threadId,
      authUser.userId,
    );
    if (!owned) return null;
    // Already resolved: answering twice is a double-submit, not an error.
    if (row.status !== 'pending') return null;

    await ctx.db.patch(args.requestId, {
      status: args.outcome === 'answered' ? 'completed' : 'rejected',
      approvedBy: authUser.userId,
      reviewedAt: Date.now(),
    });
    await stampOutcome(
      ctx,
      row.threadId,
      args.requestId,
      args.outcome === 'answered' ? 'answered' : 'skipped',
    );
    return null;
  },
});
