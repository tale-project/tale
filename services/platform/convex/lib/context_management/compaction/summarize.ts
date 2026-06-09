'use node';

/**
 * Auto-compaction action (the "compact the history into a summary and continue"
 * governor). Scheduled fire-and-forget AFTER a turn whose real prompt input
 * crossed ~90% of the model's context-window budget (see `./budget` and the
 * trigger in `lib/agent_response/generate_response.ts`), so it adds ZERO
 * latency to the turn the user is waiting on.
 *
 * What it does, idempotently:
 *   1. load the thread's messages + any existing rolling summary;
 *   2. keep the most-recent `KEEP_RECENT_RATIO` of the budget verbatim and fold
 *      everything older (and not already summarized) into a new dense summary,
 *      hierarchically (the previous summary is an input, so detail compounds
 *      instead of being lost);
 *   3. persist the summary keyed by the highest message `order` it covers.
 *
 * The context builder (`structured_context_builder.ts`) then injects that
 * summary ahead of the recent verbatim turns and drops every message at or
 * below `coversThroughOrder` — so the conversation continues seamlessly with a
 * bounded, summarized memory of everything that came before, instead of the
 * old hard "drop the oldest messages" truncation.
 */

import { listMessages, type MessageDoc } from '@convex-dev/agent';
import { generateText } from 'ai';
import { v } from 'convex/values';

import { components, internal } from '../../../_generated/api';
import { internalAction } from '../../../_generated/server';
import { resolveLanguageModelWithFallback } from '../../../providers/failover';
import { estimateMessageDocTokens, estimateTokens } from '../estimate_tokens';
import { computeCompactionSplit, KEEP_RECENT_RATIO } from './budget';
import { buildSummaryPrompt, buildTranscript, SUMMARY_SYSTEM } from './format';

/** Bump when the summary prompt/shape changes in a way that warrants a redo. */
const SUMMARY_VERSION = 1;
/** Cap the summary length — it has to stay small to be worth caching. */
const SUMMARY_MAX_OUTPUT_TOKENS = 1024;
const MESSAGE_PAGE_SIZE = 100;
/** Don't bother compacting a trivially short tail (avoids churn near the edge). */
const MIN_MESSAGES_TO_SUMMARIZE = 4;

export const compactThreadHistory = internalAction({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    /** History token budget for this thread (from `resolveContextBudget`). */
    budget: v.number(),
  },
  returns: v.object({
    compacted: v.boolean(),
    coversThroughOrder: v.optional(v.number()),
  }),
  // Explicit return type breaks the self-referential inference cycle (this
  // action references `internal.*`, which includes itself) that would otherwise
  // degrade the whole generated `api`/`internal` type to `any`.
  handler: async (
    ctx,
    args,
  ): Promise<{ compacted: boolean; coversThroughOrder?: number }> => {
    const meta = await ctx
      .runQuery(internal.threads.internal_queries.getThreadMetadata, {
        threadId: args.threadId,
      })
      .catch((err: unknown) => {
        console.warn(
          '[compaction] getThreadMetadata failed:',
          err instanceof Error ? err.message : err,
        );
        return null;
      });
    // Defense-in-depth: this is internal-only and always called with the
    // thread's real org, but verify ownership before summarizing/writing so a
    // future caller can't fold one org's thread under another's.
    if (meta?.organizationId && meta.organizationId !== args.organizationId) {
      console.warn(
        `[compaction] org mismatch for thread ${args.threadId}; skipping`,
      );
      return { compacted: false };
    }
    const prevSummary = meta?.contextSummary;
    const prevCovers = prevSummary?.coversThroughOrder ?? -1;

    // Load all messages, chronological.
    const all: MessageDoc[] = [];
    let cursor: string | null = null;
    let done = false;
    while (!done) {
      const page = await listMessages(ctx, components.agent, {
        threadId: args.threadId,
        paginationOpts: { cursor, numItems: MESSAGE_PAGE_SIZE },
        excludeToolMessages: false,
      });
      all.push(...page.page);
      cursor = page.continueCursor;
      done = page.isDone;
    }
    all.sort((a, b) =>
      a.order !== b.order ? a.order - b.order : a.stepOrder - b.stepOrder,
    );

    // Only fold in messages not already covered by the existing summary.
    const fresh = all.filter((m) => m.order > prevCovers);
    if (fresh.length < MIN_MESSAGES_TO_SUMMARIZE) {
      return { compacted: false };
    }

    // Keep the most-recent slice verbatim; summarize everything older.
    const keepBudget = Math.round(args.budget * KEEP_RECENT_RATIO);
    let splitIdx = computeCompactionSplit(
      fresh.map(estimateMessageDocTokens),
      keepBudget,
    );
    // Never bisect a single turn's same-`order` message group (e.g. an assistant
    // turn split across tool-call + result + final messages, which share one
    // `order`). `coversThroughOrder` is an `order` value and the context builder
    // drops every message with `order <= coversThroughOrder`; if the split fell
    // mid-group, the kept messages sharing that order would be dropped WITHOUT
    // being summarized — silent context loss. Snap the split down to the start of
    // the boundary group so we only ever cover complete `order` groups.
    while (
      splitIdx > 0 &&
      splitIdx < fresh.length &&
      fresh[splitIdx].order === fresh[splitIdx - 1].order
    ) {
      splitIdx--;
    }
    const toSummarize = fresh.slice(0, splitIdx);
    if (toSummarize.length < MIN_MESSAGES_TO_SUMMARIZE) {
      // Recent window already holds (almost) everything — nothing worth folding.
      return { compacted: false };
    }

    const transcript = buildTranscript(toSummarize);
    if (!transcript.trim()) return { compacted: false };
    const newCovers = toSummarize[toSummarize.length - 1].order;

    let summaryText: string;
    try {
      const { languageModel } = await resolveLanguageModelWithFallback(ctx, {
        tag: 'chat',
        organizationId: args.organizationId,
      });
      const { text } = await generateText({
        model: languageModel,
        system: SUMMARY_SYSTEM,
        prompt: buildSummaryPrompt(prevSummary?.text, transcript),
        maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
      });
      summaryText = text.trim();
    } catch (err) {
      console.warn(
        `[compaction] summarization failed thread=${args.threadId}:`,
        err instanceof Error ? err.message : err,
      );
      return { compacted: false };
    }
    if (!summaryText) return { compacted: false };

    const res = await ctx.runMutation(
      internal.threads.internal_mutations.updateThreadContextSummary,
      {
        threadId: args.threadId,
        text: summaryText,
        coversThroughOrder: newCovers,
        tokens: estimateTokens(summaryText),
        sourceMessageCount:
          toSummarize.length + (prevSummary?.sourceMessageCount ?? 0),
        nowMs: Date.now(),
        version: SUMMARY_VERSION,
      },
    );
    return { compacted: res.applied, coversThroughOrder: newCovers };
  },
});
