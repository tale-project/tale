'use node';

// Continuation action — resumes an external-agent turn a prior action handed
// off when its ~25min window elapsed (the >30min-ceiling path) OR when the
// current segment's message neared the 1MB doc cap. It re-attaches to the
// still-running sandbox exec from the checkpoint cursor (no new exec, no new VK)
// and streams into the FRESH segment message the handoff opened (S4). On
// terminal it finalizes; on another handoff it schedules the next continuation.

import { v } from 'convex/values';

import type { Id } from '../../_generated/dataModel';
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
  process.env.EXTERNAL_AGENT_TURN_TIMEOUT_MS ?? String(24 * 60 * 60 * 1000),
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
    /** Turn posture, frozen at exec start — carried so the terminal plan
     * detection knows how the turn ran. */
    permissionMode: v.optional(
      v.union(v.literal('plan'), v.literal('execute')),
    ),
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
      ...(args.permissionMode !== undefined && {
        permissionMode: args.permissionMode,
      }),
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
        ...(args.streamId !== undefined && { streamId: args.streamId }),
        execId: args.execId,
        agentSlug: args.agentKind,
        // Unused on resume — no new exec is built (we re-attach).
        prompt: '',
        gatewayBaseUrl: '',
        gatewayToken: '',
        timeoutMs: TURN_TIMEOUT_MS,
        budgetDeadlineMs: Date.now() + ACTION_WINDOW_MS,
        ...(args.permissionMode !== undefined && {
          permissionMode: args.permissionMode,
        }),
        resumeFrom: {
          lastSeq: checkpoint.lastSeq,
          ...(checkpoint.agentSessionId !== undefined && {
            agentSessionId: checkpoint.agentSessionId,
          }),
          ...(checkpoint.planText !== undefined && {
            planText: checkpoint.planText,
          }),
          ...(checkpoint.toolNames !== undefined && {
            toolNames: checkpoint.toolNames,
          }),
          ...(checkpoint.agentResultSeen === true && {
            agentResultSeen: true,
          }),
          ...(checkpoint.agentIdle === true && { agentIdle: true }),
          ...(checkpoint.pendingTaskIds !== undefined && {
            pendingTaskIds: checkpoint.pendingTaskIds,
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
        (e) => console.warn('[continueExternalAgentTurn] mark failed:', e),
      );
      await finalizeTurnSideEffects(ctx, turn).catch((e) =>
        console.warn('[continueExternalAgentTurn] finalize failed:', e),
      );
    } finally {
      // The consumed checkpoint blob is superseded (a fresh handoff wrote a new
      // one, or the turn ended) — best-effort cleanup.
      await ctx.storage
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        .delete(args.checkpointStorageId as Id<'_storage'>)
        .catch((e) =>
          console.warn('[continueExternalAgentTurn] checkpoint cleanup:', e),
        );
    }
    return null;
  },
});
