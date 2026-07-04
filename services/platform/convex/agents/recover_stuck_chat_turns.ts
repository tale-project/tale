/**
 * Recovery watchdog for plain chat turns whose generation action was killed
 * without finalizing — the backstop to the deploy drain (`control/drain.ts`).
 *
 * The deploy drain waits for in-flight generations before recreating convex,
 * but a turn that outlasts the drain budget (or a crash / the 30-min action
 * ceiling) is still hard-killed mid-stream. A plain chat turn has no
 * out-of-process source of truth (unlike a sandbox exec), so there is nothing
 * to resume — re-calling the LLM would lose the partial stream and double-bill.
 * The honest recovery is to FINALIZE: keep whatever streamed as a success
 * bubble, else mark the turn failed with a clear, retryable "backend restarted"
 * envelope, and clear the stuck `generating` lock so the UI unblocks.
 *
 * Plain chat turns have no recovery cron today (only external-agent turns and
 * sandbox executions do); this fills that gap. External-agent turns are handled
 * by their own 2-min restorative sweep well before this 35-min threshold, so
 * this watchdog effectively only finalizes plain turns and any straggler the
 * other sweeps missed.
 */

import {
  abortStream,
  listMessages,
  listStreams,
  saveMessage,
} from '@convex-dev/agent';
import { v } from 'convex/values';

import {
  buildHumanErrorSentence,
  encodeChatError,
} from '../../lib/shared/chat-errors';
import { components } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import { isE2ECronSuppressed } from '../lib/e2e_cron_guard';
import { GENERATION_STALE_THRESHOLD_MS } from '../threads/generation_liveness';

/**
 * Cap finalizations per run so a pathological backlog can't blow the mutation's
 * read/time budget; the next 5-min tick continues. (Iterating the `generating`
 * index itself is cheap — it's the small set of currently-active threads.)
 */
const RECOVERY_SWEEP_LIMIT = 50;

/** A failed turn cut by a backend restart: a clear, localized, retryable bubble. */
function backendRestartError(): string {
  return encodeChatError({
    code: 'provider_unreachable',
    raw: 'The backend restarted during generation (deploy or crash). Please send the message again.',
  });
}

export const recoverStuckChatTurns = internalMutation({
  args: {},
  returns: v.object({ finalized: v.number() }),
  handler: async (ctx) => {
    if (isE2ECronSuppressed()) return { finalized: 0 };
    const staleBefore = Date.now() - GENERATION_STALE_THRESHOLD_MS;
    let finalized = 0;

    for await (const meta of ctx.db
      .query('threadMetadata')
      .withIndex('by_generationStatus', (q) =>
        q.eq('generationStatus', 'generating'),
      )) {
      if (finalized >= RECOVERY_SWEEP_LIMIT) break;

      const lastAlive = Math.max(
        meta.generationStartTime ?? 0,
        meta.generationHeartbeatAt ?? 0,
      );
      // Legacy rows with no liveness anchor are treated as "not stale" (matches
      // isGenerationFresh) so the UI never unblocks them prematurely; skip.
      if (lastAlive === 0 || lastAlive > staleBefore) continue;

      try {
        // Finalize-once guard: re-read and confirm still generating on the SAME
        // stream before mutating, so a turn that recovered between the scan and
        // now is never clobbered (mirrors clearGenerationStatus).
        const fresh = await ctx.db.get(meta._id);
        if (
          !fresh ||
          fresh.generationStatus !== 'generating' ||
          fresh.streamId !== meta.streamId
        ) {
          continue;
        }

        // Abort any lingering SDK streams for this thread.
        const streams = await listStreams(ctx, components.agent, {
          threadId: fresh.threadId,
          includeStatuses: ['streaming'],
        });
        for (const stream of streams) {
          await abortStream(ctx, components.agent, {
            streamId: stream.streamId,
            reason: 'backend-restart',
          });
        }

        // Finalize the newest assistant message: preserve streamed text as a
        // success bubble (mirrors cancelGeneration), else surface the error.
        const msgs = await listMessages(ctx, components.agent, {
          threadId: fresh.threadId,
          paginationOpts: { numItems: 5, cursor: null },
          excludeToolMessages: true,
        });
        const latestAssistant = msgs.page.find(
          (m) => m.message?.role === 'assistant',
        );

        if (latestAssistant && latestAssistant.status !== 'success') {
          if (latestAssistant.text?.trim()) {
            await ctx.runMutation(components.agent.messages.updateMessage, {
              messageId: latestAssistant._id,
              patch: { status: 'success' },
            });
          } else {
            await ctx.runMutation(components.agent.messages.updateMessage, {
              messageId: latestAssistant._id,
              patch: {
                status: 'failed',
                error: backendRestartError(),
                message: {
                  role: 'assistant' as const,
                  content: buildHumanErrorSentence('provider_unreachable'),
                },
              },
            });
          }
        } else if (!latestAssistant) {
          // No assistant message was saved before the kill — surface one so the
          // user sees why the turn ended rather than a silent unblock.
          await saveMessage(ctx, components.agent, {
            threadId: fresh.threadId,
            message: {
              role: 'assistant',
              content: buildHumanErrorSentence('provider_unreachable'),
            },
            metadata: { status: 'failed', error: backendRestartError() },
          });
        }

        await ctx.db.patch(fresh._id, {
          generationStatus: 'idle' as const,
          streamId: undefined,
          updatedAt: Date.now(),
          lastReplyAt: Date.now(),
        });
        finalized += 1;
      } catch (err) {
        console.warn(
          `[recoverStuckChatTurns] finalize failed for thread ${meta.threadId}:`,
          err,
        );
      }
    }

    if (finalized > 0) {
      console.warn(
        `[recoverStuckChatTurns] finalized ${finalized} stuck chat turn(s)`,
      );
    }
    return { finalized };
  },
});
