'use node';

/**
 * The coding-agent turn's KICK: one chat message answered by a third-party
 * harness (Claude Code, Codex, …) inside the thread's sandbox session.
 *
 * The turn is ASYNC. This action persists the user message and an assistant
 * placeholder, opens the generation, ensures the session, provisions the
 * gateway key, and STARTS the harness exec — draining the FIRST window inline
 * (so a fast/warm turn settles here without a second hop, and the gateway
 * token this window holds never has to persist). If the turn is still running
 * when the window closes, it schedules `chat.coding_turn_drive.driveCodingTurn`
 * to keep draining in short self-chaining windows, and RETURNS: the harness
 * runs on in the sandbox independent of any Convex action, and the reply
 * streams into the `messages`/`generations` rows the client subscribes to.
 *
 * V1 serves the MANAGED credential path (org provider credentials reach the
 * container only as a session-scoped gateway key). Subscription credentials
 * and connector (MCP) bridging are deferred; the picked connectors are stored
 * on the thread but not yet mounted.
 */

import { randomUUID } from 'node:crypto';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action, type ActionCtx } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { sessionCancelExec } from '../node_only/sandbox/helpers/session_client';
import { resolveGatewayRouting } from '../node_only/sandbox/llm_gateway_admin';
import { sessionIdForUser } from '../sandbox/session_naming';
import {
  buildCodingExec,
  CODING_TURN_DEADLINE_MS,
  drainCodingWindow,
  ensureAgentSession,
  finalizeCodingTurn,
  isManagedHarness,
  newExecId,
  openCodingOp,
  provisionTurnGatewayToken,
  resolveManagedModel,
  stageSkills,
  type CodingTurnScope,
} from './coding_turn_shared';

/** Append an assistant message carrying a refusal, with no generation opened —
 * used before the turn actually starts (bad harness, no model, missing
 * thread). Returns the refusal shape the seam surfaces. */
async function refuseBeforeStart(
  ctx: ActionCtx,
  scope: Pick<CodingTurnScope, 'organizationId' | 'threadId'>,
  reason: string,
): Promise<{ status: 'refused'; reason: string }> {
  await ctx.runMutation(internal.chat.messages.appendMessageInternal, {
    organizationId: scope.organizationId,
    threadId: scope.threadId,
    role: 'assistant',
    parts: [{ type: 'text', text: reason }],
    blockedReason: reason,
  });
  return { status: 'refused', reason };
}

export const startCodingTurn = action({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    userText: v.string(),
    harness: v.string(),
  },
  returns: v.object({
    status: v.union(v.literal('completed'), v.literal('refused')),
    reason: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ status: 'completed' | 'refused'; reason?: string }> => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    const scope: CodingTurnScope = {
      organizationId: args.organizationId,
      threadId: args.threadId,
      userId: auth.userId,
    };

    const thread = await ctx.runQuery(
      internal.chat.threads.getOwnedThreadInternal,
      {
        organizationId: args.organizationId,
        userId: auth.userId,
        threadId: args.threadId,
      },
    );
    if (thread === null) {
      return { status: 'refused', reason: 'This conversation does not exist.' };
    }

    // The managed lane can only run a managed-capable harness — refuse a
    // byo-only one (e.g. Cursor) up front rather than build an inert exec that
    // hangs to the turn deadline. Defensive: the composer already filters these
    // out of its picker, but a stale thread pin or a direct API call could still
    // name one.
    if (!isManagedHarness(args.harness)) {
      return {
        status: 'refused',
        reason: `The coding agent "${args.harness}" can't run here yet — it needs its own credentials, which this chat lane does not support.`,
      };
    }

    // At most one turn per thread. Refuse a concurrent send BEFORE appending
    // anything, so a second send can't overwrite the running turn's generation
    // and orphan its exec (and double-charge on finalize).
    const busy = await ctx.runQuery(
      internal.chat.generations.hasLiveGenerationInternal,
      { organizationId: args.organizationId, threadId: args.threadId },
    );
    if (busy) {
      return {
        status: 'refused',
        reason: 'This conversation is already generating a response.',
      };
    }

    await ctx.runMutation(internal.chat.messages.appendMessageInternal, {
      organizationId: args.organizationId,
      threadId: args.threadId,
      role: 'user',
      parts: [{ type: 'text', text: args.userText }],
    });

    const model = await resolveManagedModel(ctx, args.organizationId);
    if (model === null) {
      return refuseBeforeStart(
        ctx,
        scope,
        'This coding agent needs a model to run on, and the organization has no directly usable AI provider credential. Connect one under Settings → AI providers.',
      );
    }
    const routing = resolveGatewayRouting(model.providerSlug, model.modelId);
    const execId = newExecId();
    const streamId = randomUUID();
    // One wall-clock cutoff for the whole turn, shared by the token expiry, the
    // op row's deadline, and the drive loop's reschedule guard.
    const deadlineAt = Date.now() + CODING_TURN_DEADLINE_MS;

    // The assistant message the reply streams into, and the generation that
    // carries the drainer's re-attach state.
    const { id: messageId } = await ctx.runMutation(
      internal.chat.messages.appendMessageInternal,
      {
        organizationId: args.organizationId,
        threadId: args.threadId,
        role: 'assistant',
        parts: [{ type: 'text', text: '' }],
      },
    );
    await ctx.runMutation(internal.chat.generations.beginGenerationInternal, {
      organizationId: args.organizationId,
      threadId: args.threadId,
      streamId,
      messageId,
      coding: {
        execId,
        lastSeq: 0,
        harness: args.harness,
        providerSlug: model.providerSlug,
        gatewayModel: routing.gatewayModel,
      },
    });

    // `sessionId` is set once the session is ensured; the catch below uses it to
    // finalize + revoke through the op row when a later setup step throws.
    let sessionId: string | undefined;
    try {
      sessionId = await ensureAgentSession(ctx, scope);
      const { token, keyId } = await provisionTurnGatewayToken(
        ctx,
        scope,
        sessionId,
        model,
        {
          harness: args.harness,
          gatewayModel: routing.gatewayModel,
          expiresAt: deadlineAt,
        },
      );
      // Open the turn's op row now that the VK id exists: it is the single
      // source of truth the finalize claim, the fleet page, and the recovery
      // watchdog read, and it carries the `mintedKeyId` that makes the VK
      // revocable on every exit.
      await openCodingOp(ctx, {
        scope,
        sessionId,
        execId,
        messageId,
        providerSlug: model.providerSlug,
        gatewayModel: routing.gatewayModel,
        streamId,
        deadlineMs: deadlineAt,
        mintedKeyId: keyId,
      });
      const instructions = await stageSkills(
        ctx,
        scope,
        sessionId,
        thread.capabilities?.skills ?? [],
      );
      const exec = buildCodingExec({
        harness: args.harness,
        gatewayModel: routing.gatewayModel,
        gatewayToken: token,
        instructions,
        prompt: args.userText,
        ...(thread.codingResume !== undefined
          ? { resume: thread.codingResume }
          : {}),
        execId,
      });

      const outcome = await drainCodingWindow(ctx, {
        scope,
        sessionId,
        execId,
        messageId,
        harness: args.harness,
        providerSlug: model.providerSlug,
        gatewayModel: routing.gatewayModel,
        start: exec,
      });

      if (outcome.kind === 'gone') {
        await finalizeCodingTurn(ctx, {
          scope,
          sessionId,
          execId,
          messageId,
          providerSlug: model.providerSlug,
          gatewayModel: routing.gatewayModel,
          fallbackText: '',
          errored: true,
          reason: 'The sandbox session ended before the turn could run.',
        });
        return {
          status: 'refused',
          reason: 'The sandbox session ended before the turn could run.',
        };
      }
      if (outcome.kind === 'continue') {
        await ctx.scheduler.runAfter(
          0,
          internal.chat.coding_turn_drive.driveCodingTurn,
          {
            organizationId: args.organizationId,
            threadId: args.threadId,
            userId: auth.userId,
            deadlineAt,
          },
        );
      }
      return { status: 'completed' };
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'The coding turn failed.';
      console.error('[coding-turn] kick failed:', error);
      await finalizeCodingTurn(ctx, {
        scope,
        ...(sessionId !== undefined ? { sessionId, execId } : {}),
        messageId,
        providerSlug: model.providerSlug,
        gatewayModel: routing.gatewayModel,
        fallbackText: '',
        errored: true,
        reason: `The coding agent could not run: ${reason}`,
      });
      // The finalize wrote the reason under the message; surface it on the seam
      // toast too.
      return {
        status: 'refused',
        reason: `The coding agent could not run: ${reason}`,
      };
    }
  },
});

/**
 * Stop the caller's in-flight coding turn on a thread. Cancels the harness exec
 * in the sandbox (SIGTERM→SIGKILL via runnerd) and settles the turn through the
 * shared finalize: the exactly-once claim revokes the turn's gateway VK, stamps
 * the op row `cancelled`, and deletes the generation so the composer unlocks.
 * The partial reply that already streamed is kept, with a stop note under it.
 *
 * Idempotent and owner-scoped: a thread with no live coding turn (already
 * settled, or not the caller's) returns `{stopped:false}`. Racing the drain
 * loop is safe — whichever finalizer wins the claim runs the side-effects once;
 * the loser bails.
 */
export const stopCodingTurn = action({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.object({ stopped: v.boolean() }),
  handler: async (ctx, args): Promise<{ stopped: boolean }> => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    const thread = await ctx.runQuery(
      internal.chat.threads.getOwnedThreadInternal,
      {
        organizationId: args.organizationId,
        userId: auth.userId,
        threadId: args.threadId,
      },
    );
    if (thread === null) return { stopped: false };

    const state = await ctx.runQuery(
      internal.chat.generations.getCodingStateInternal,
      { organizationId: args.organizationId, threadId: args.threadId },
    );
    if (state === null) return { stopped: false };

    const scope: CodingTurnScope = {
      organizationId: args.organizationId,
      threadId: args.threadId,
      userId: auth.userId,
    };
    const sessionId = sessionIdForUser(args.organizationId, auth.userId);
    const { messageId, coding } = state;

    await sessionCancelExec(sessionId, coding.execId).catch((err) =>
      console.warn('[coding-turn] stop exec cancel failed:', err),
    );
    await finalizeCodingTurn(ctx, {
      scope,
      sessionId,
      execId: coding.execId,
      messageId,
      providerSlug: coding.providerSlug,
      gatewayModel: coding.gatewayModel,
      fallbackText: '',
      errored: false,
      cancelled: true,
      reason: 'You stopped this response.',
    });
    return { stopped: true };
  },
});
