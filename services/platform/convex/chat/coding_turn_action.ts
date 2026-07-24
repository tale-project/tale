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
import { resolveGatewayRouting } from '../node_only/sandbox/llm_gateway_admin';
import {
  buildCodingExec,
  CODING_TURN_DEADLINE_MS,
  drainCodingWindow,
  ensureAgentSession,
  finalizeCodingTurn,
  newExecId,
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
      streamId: randomUUID(),
      messageId,
      coding: {
        execId,
        lastSeq: 0,
        harness: args.harness,
        providerSlug: model.providerSlug,
        gatewayModel: routing.gatewayModel,
      },
    });

    try {
      const sessionId = await ensureAgentSession(ctx, scope);
      const token = await provisionTurnGatewayToken(
        ctx,
        scope,
        sessionId,
        model,
      );
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
          messageId,
          providerSlug: model.providerSlug,
          gatewayModel: routing.gatewayModel,
          fallbackText: '',
          errored: true,
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
            deadlineAt: Date.now() + CODING_TURN_DEADLINE_MS,
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
        messageId,
        providerSlug: model.providerSlug,
        gatewayModel: routing.gatewayModel,
        fallbackText: '',
        errored: true,
      });
      // The finalize wrote a generic "ended without a reply"; make the seam's
      // toast carry the real cause.
      return {
        status: 'refused',
        reason: `The coding agent could not run: ${reason}`,
      };
    }
  },
});
