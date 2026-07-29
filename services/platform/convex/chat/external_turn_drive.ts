'use node';

/**
 * The external turn's DRAINER: a self-chaining internal action that keeps a
 * long turn's reply flowing without holding any single Convex action open.
 *
 * Each invocation ATTACHES to the still-running harness exec (started by the
 * scheduled `startExternalTurnExec`) from the ring-buffer start, drains one
 * short window, updates the
 * assistant message, and settles the turn if it ended. Still running at the
 * window's close → it reschedules itself; past the overall deadline → it cuts
 * the exec and settles with a timeout reason. A turn that already settled (its
 * generation row is gone — e.g. the user stopped it) makes this a no-op.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { sessionCancelExec } from '../node_only/sandbox/helpers/session_client';
import { sessionIdForUser } from '../sandbox/session_naming';
import {
  drainExternalTurnWindow,
  finalizeExternalTurn,
  type ExternalTurnScope,
} from './external_turn_shared';

export const driveExternalTurn = internalAction({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    userId: v.string(),
    /** Wall-clock cutoff carried across every reschedule. */
    deadlineAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await ctx.runQuery(
      internal.chat.generations.getExternalTurnStateInternal,
      { organizationId: args.organizationId, threadId: args.threadId },
    );
    // No live external-turn generation → the turn already settled (completed, or the
    // user stopped it). Nothing to drive.
    if (state === null) return null;

    const scope: ExternalTurnScope = {
      organizationId: args.organizationId,
      threadId: args.threadId,
      userId: args.userId,
    };
    const sessionId = sessionIdForUser(args.organizationId, args.userId);
    const { messageId, external } = state;

    // Past the deadline → cut the exec and settle with a reason rather than
    // let a hung harness reschedule forever.
    if (Date.now() > args.deadlineAt) {
      await sessionCancelExec(sessionId, external.execId).catch((err) =>
        console.warn('[external-turn] deadline exec cancel failed:', err),
      );
      await finalizeExternalTurn(ctx, {
        scope,
        sessionId,
        execId: external.execId,
        messageId,
        providerSlug: external.providerSlug,
        gatewayModel: external.gatewayModel,
        fallbackText: '',
        errored: true,
        timedOut: true,
        harness: external.harness,
        reason:
          'The third-party agent ran past its time limit and was stopped.',
      });
      return null;
    }

    let outcome;
    try {
      outcome = await drainExternalTurnWindow(ctx, {
        scope,
        sessionId,
        execId: external.execId,
        messageId,
        harness: external.harness,
        providerSlug: external.providerSlug,
        gatewayModel: external.gatewayModel,
      });
    } catch (err) {
      // A window that THREW (staging failure, exhausted reconnects, a Convex
      // hiccup) must not silently end the chain and strand the thread — route
      // it to the same unified failure exit. finalize's exactly-once claim
      // keeps this from racing the crash-recovery sweep.
      console.error('[external-turn] drive window threw:', err);
      await finalizeExternalTurn(ctx, {
        scope,
        sessionId,
        execId: external.execId,
        messageId,
        providerSlug: external.providerSlug,
        gatewayModel: external.gatewayModel,
        fallbackText: '',
        errored: true,
        harness: external.harness,
        reason: 'The third-party agent stopped unexpectedly.',
      });
      return null;
    }

    if (outcome.kind === 'continue') {
      await ctx.scheduler.runAfter(
        0,
        internal.chat.external_turn_drive.driveExternalTurn,
        {
          organizationId: args.organizationId,
          threadId: args.threadId,
          userId: args.userId,
          deadlineAt: args.deadlineAt,
        },
      );
    } else if (outcome.kind === 'gone') {
      await finalizeExternalTurn(ctx, {
        scope,
        sessionId,
        execId: external.execId,
        messageId,
        providerSlug: external.providerSlug,
        gatewayModel: external.gatewayModel,
        fallbackText: '',
        errored: true,
        harness: external.harness,
        reason: 'The sandbox session ended before the turn finished.',
      });
    }
    // 'done' → drainExternalTurnWindow already finalized.
    return null;
  },
});
