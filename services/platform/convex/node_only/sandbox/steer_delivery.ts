'use node';

// Mid-turn steering delivery: stage queued chat messages into the RUNNING
// external-agent exec's steer dir (TALE_STEER_DIR=/workspace/.tale/steer/
// <execId>). The in-image tale-steer-hook injects them into the running turn
// at the next tool-use / stop boundary.
//
// Delivery state machine (chatMessageQueue.status):
//   queued → delivered   here, only after the spawner confirms the file staged
//                        AND the exec is still running (markDelivered guard).
//   delivered → consumed live (parser sees the Stop-hook injection) or at the
//                        terminal reconciliation in finalizeTurnSideEffects.
//   delivered → queued   terminal reconciliation, when the turn died before
//                        the hook consumed the file (at-least-once).

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { sessionStageFiles } from './helpers/session_client';

/** Filename for a staged steer message. The hook consumes `steer-*.json` and
 * renames to `consumed.<name>`, so the platform can reconcile from a directory
 * listing alone. createdAt prefix keeps the hook's glob-sort in send order. */
export function steerFileName(createdAt: number, messageId: string): string {
  return `steer-${String(createdAt).padStart(15, '0')}-${messageId}.json`;
}

export function steerDirFor(execId: string): string {
  return `.tale/steer/${execId}`;
}

export const deliverSteerMessages = internalAction({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(
      internal.sandbox.session_queries.getRunningAgentRunByThread,
      { threadId: args.threadId },
    );
    // Steering is a Claude Code mechanism (hooks); other kinds drain at the
    // turn boundary instead. No running exec → boundary drain handles it too.
    if (!target || target.agentKind !== 'claude-code') return null;

    const rows = await ctx.runQuery(
      internal.threads.message_queue.listQueuedForDelivery,
      { threadId: args.threadId },
    );
    if (rows.length === 0) return null;

    const dir = steerDirFor(target.execId);
    const files = rows.map((row) => ({
      path: `${dir}/${steerFileName(row.createdAt, row.messageId)}`,
      contentBase64: Buffer.from(
        JSON.stringify({
          messageId: row.messageId,
          text: row.text,
          createdAt: row.createdAt,
        }),
        'utf8',
      ).toString('base64'),
    }));

    let stagedPaths: Set<string>;
    try {
      const result = await sessionStageFiles(target.sessionId, files);
      stagedPaths = new Set(result.staged.map((s) => s.path));
      for (const skip of result.skipped) {
        console.warn(
          `[steer_delivery] stage skipped ${skip.path}: ${skip.reason}`,
        );
      }
    } catch (err) {
      // Leave the rows queued — the boundary drain is the fallback.
      console.warn('[steer_delivery] stage failed:', err);
      return null;
    }

    const deliveredIds = rows
      .filter((row, i) => stagedPaths.has(files[i]?.path ?? ''))
      .map((row) => row.queueId);
    if (deliveredIds.length > 0) {
      await ctx.runMutation(internal.threads.message_queue.markDelivered, {
        threadId: args.threadId,
        queueIds: deliveredIds,
        execId: target.execId,
      });
    }
    return null;
  },
});
