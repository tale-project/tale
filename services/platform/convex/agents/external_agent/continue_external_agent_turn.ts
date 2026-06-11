'use node';

// Continuation action — resumes an external-agent turn a prior action handed
// off when its ~25min window elapsed (the >30min-ceiling path). It re-attaches
// to the still-running sandbox exec from the checkpoint cursor (no new exec, no
// new VK) and keeps building the SAME streaming message. On terminal it
// finalizes; on another handoff it schedules the next continuation.

import { v } from 'convex/values';

import { internalAction } from '../../_generated/server';
import { runAgentInSessionImpl } from '../../node_only/sandbox/run_agent';
import {
  finalizeTurnSideEffects,
  handleTurnOutcome,
  loadCheckpoint,
  markMessageStatus,
  patchStreamingMessage,
  type TurnContext,
} from './turn_lifecycle';

const ACTION_WINDOW_MS = Number(
  process.env.EXTERNAL_AGENT_ACTION_WINDOW_MS ?? String(25 * 60 * 1000),
);
const TURN_TIMEOUT_MS = Number(
  process.env.EXTERNAL_AGENT_TURN_TIMEOUT_MS ?? String(2 * 60 * 60 * 1000),
);

export const continueExternalAgentTurn = internalAction({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    execId: v.string(),
    threadId: v.string(),
    agentKind: v.union(v.literal('claude-code'), v.literal('opencode')),
    agentSlug: v.optional(v.string()),
    modelRef: v.string(),
    userId: v.optional(v.string()),
    streamId: v.optional(v.string()),
    assistantMessageId: v.string(),
    mintedKeyId: v.union(v.string(), v.null()),
    continuationCount: v.number(),
    checkpointStorageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turn: TurnContext = {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      execId: args.execId,
      threadId: args.threadId,
      agentKind: args.agentKind,
      modelRef: args.modelRef,
      assistantMessageId: args.assistantMessageId,
      mintedKeyId: args.mintedKeyId,
      continuationCount: args.continuationCount,
      ...(args.agentSlug !== undefined && { agentSlug: args.agentSlug }),
      ...(args.userId !== undefined && { userId: args.userId }),
      ...(args.streamId !== undefined && { streamId: args.streamId }),
    };

    const checkpoint = await loadCheckpoint(ctx, args.checkpointStorageId);
    if (!checkpoint) {
      // Checkpoint blob gone (evicted / never written) — can't resume. Mark the
      // message failed (preserving the timeline it already has) + finalize.
      await markMessageStatus(ctx, args.assistantMessageId, 'failed');
      await finalizeTurnSideEffects(ctx, turn);
      return null;
    }

    try {
      const result = await runAgentInSessionImpl(ctx, {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        threadId: args.threadId,
        execId: args.execId,
        agentSlug: args.agentKind,
        // Unused on resume — no new exec is built (we re-attach).
        prompt: '',
        gatewayBaseUrl: '',
        gatewayToken: '',
        timeoutMs: TURN_TIMEOUT_MS,
        budgetDeadlineMs: Date.now() + ACTION_WINDOW_MS,
        resumeFrom: {
          timeline: checkpoint.timeline,
          lastSeq: checkpoint.lastSeq,
          ...(checkpoint.agentSessionId !== undefined && {
            agentSessionId: checkpoint.agentSessionId,
          }),
        },
        onTimeline: async (content) => {
          await patchStreamingMessage(ctx, args.assistantMessageId, content);
        },
      });
      await handleTurnOutcome(ctx, turn, result);
    } catch (err) {
      console.error('[continueExternalAgentTurn] failed:', err);
      // Preserve the partial timeline already on the message; just flip status.
      await markMessageStatus(ctx, args.assistantMessageId, 'failed').catch(
        () => {},
      );
      await finalizeTurnSideEffects(ctx, turn).catch(() => {});
    } finally {
      // The consumed checkpoint blob is superseded (a fresh handoff wrote a new
      // one, or the turn ended) — best-effort cleanup.
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
      await ctx.storage.delete(args.checkpointStorageId as any).catch(() => {});
    }
    return null;
  },
});
