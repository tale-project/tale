'use node';

/**
 * The arena send: ONE user prompt fanned into BOTH columns of a pair, each
 * column running the ordinary direct turn with its own model.
 *
 * The two turns run concurrently and are deliberately isolated: a failure on
 * one side — even before its pipeline starts, where no store exists to write
 * the error — records an assistant error message on ITS thread and leaves
 * the other column streaming. A dead model must never blank the comparison.
 */

import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import { action, type ActionCtx } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { sanitizeError } from '../lib/utils/sanitize_secrets';
import { executeTurn } from './turn_action';

const sideResultValidator = v.object({
  status: v.union(v.literal('completed'), v.literal('refused')),
  reason: v.optional(v.string()),
});

interface SideResult {
  status: 'completed' | 'refused';
  reason?: string;
}

/** Run one column's turn, converting every failure shape — refusal or throw —
 * into a visible assistant error row on that column. */
async function runSide(
  ctx: ActionCtx,
  side: {
    organizationId: string;
    userId: string;
    threadId: string;
    userText: string;
    modelId: string;
    providerSlug?: string;
    agentSlug?: string;
    locale: string;
  },
): Promise<SideResult> {
  try {
    const outcome = await executeTurn(ctx, {
      organizationId: side.organizationId,
      userId: side.userId,
      threadId: side.threadId,
      userText: side.userText,
      modelId: side.modelId,
      ...(side.providerSlug !== undefined && {
        providerSlug: side.providerSlug,
      }),
      sandbox: false,
      agentSlug: side.agentSlug,
      locale: side.locale,
    });
    return outcome.status === 'completed'
      ? { status: 'completed' }
      : { status: 'refused', reason: outcome.reason };
  } catch (err) {
    // A pre-pipeline throw (model resolution, credential) left nothing in
    // the transcript — write the error row here so the column explains
    // itself instead of sitting silently half-empty.
    const reason = sanitizeError(err);
    try {
      await ctx.runMutation(internal.chat.messages.appendMessageInternal, {
        organizationId: side.organizationId,
        threadId: side.threadId,
        role: 'assistant',
        parts: [],
        model: side.modelId,
        error: reason,
      });
    } catch (writeErr) {
      console.error('[arena] could not record side failure', writeErr);
    }
    return { status: 'refused', reason };
  }
}

/**
 * Fan one prompt out to both columns. The user message is appended to each
 * thread by its own turn, so the two histories stay independently replayable.
 * Busy-gates both sides up front — a half-sent prompt (one column busy, one
 * not) would desynchronize the comparison.
 */
export const startArenaTurn = action({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    userText: v.string(),
    modelIdA: v.string(),
    modelIdB: v.string(),
    providerSlugA: v.optional(v.string()),
    providerSlugB: v.optional(v.string()),
    locale: v.optional(v.string()),
  },
  returns: v.object({ a: sideResultValidator, b: sideResultValidator }),
  handler: async (ctx, args): Promise<{ a: SideResult; b: SideResult }> => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);

    const owned = await ctx.runQuery(
      internal.chat.threads.getOwnedThreadInternal,
      {
        organizationId: args.organizationId,
        userId: auth.userId,
        threadId: args.threadId,
      },
    );
    if (owned === null || owned.arena === undefined) {
      throw new ConvexError({
        code: 'not_found',
        message: 'This conversation is not in an arena pair.',
      });
    }
    const threadIdA =
      owned.arena.role === 'a' ? args.threadId : owned.arena.partnerThreadId;
    const threadIdB =
      owned.arena.role === 'a' ? owned.arena.partnerThreadId : args.threadId;

    const busyA = await ctx.runQuery(
      internal.chat.generations.hasLiveGenerationInternal,
      { organizationId: args.organizationId, threadId: threadIdA },
    );
    const busyB = await ctx.runQuery(
      internal.chat.generations.hasLiveGenerationInternal,
      { organizationId: args.organizationId, threadId: threadIdB },
    );
    if (busyA || busyB) {
      const busy: SideResult = {
        status: 'refused',
        reason: 'This conversation is already generating a response.',
      };
      return { a: busy, b: busy };
    }

    const locale = args.locale ?? 'en';
    const shared = {
      organizationId: args.organizationId,
      userId: auth.userId,
      userText: args.userText,
      agentSlug: owned.agentSlug,
      locale,
    };
    const [a, b] = await Promise.all([
      runSide(ctx, {
        ...shared,
        threadId: threadIdA,
        modelId: args.modelIdA,
        ...(args.providerSlugA !== undefined && {
          providerSlug: args.providerSlugA,
        }),
      }),
      runSide(ctx, {
        ...shared,
        threadId: threadIdB,
        modelId: args.modelIdB,
        ...(args.providerSlugB !== undefined && {
          providerSlug: args.providerSlugB,
        }),
      }),
    ]);
    return { a, b };
  },
});
