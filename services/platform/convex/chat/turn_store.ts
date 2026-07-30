/**
 * The Convex-backed ports the turn pipeline writes through.
 *
 * `lib/chat/turn.ts` is pure: it takes a `TurnStore` and a `UsageLedger` as
 * injected ports and never imports Convex, so it runs end to end in a unit
 * test. This module is the other half — the real implementations that persist
 * to the chat tables and the organization's usage ledger.
 *
 * It is deliberately NOT a `'use node'` module: every write is a
 * `ctx.runMutation` into an internal mutation, so the adapters work from the
 * node action that drives a turn AND from a V8 test that supplies an action
 * context. Keeping the node-only pieces (the model call, the harness table) in
 * `turn_action.ts` lets a test exercise the whole store against a fake model
 * without a Node runtime.
 */

import { estimateCostCents } from '../../lib/chat/turn';
import type { TurnStore, UsageLedger } from '../../lib/chat/turn';
import type { ModelCatalogEntry } from '../../lib/shared/schemas/providers';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';

/** The floor between two streaming-progress writes. The reply repaints at a
 * reading cadence while the mutation load stays one write per interval, not
 * one per SSE chunk; the finalize write carries the authoritative text, so
 * skipped intervals never lose the tail. */
const STREAM_WRITE_INTERVAL_MS = 250;

/** A turn store that writes to the `messages` and `generations` tables. */
export function createConvexTurnStore(ctx: ActionCtx): TurnStore {
  let lastStreamWriteAt = 0;
  let lastCancelRequested = false;
  return {
    async appendMessage(message) {
      return ctx.runMutation(internal.chat.messages.appendMessageInternal, {
        organizationId: message.organizationId,
        threadId: message.threadId,
        role: message.role,
        parts: message.parts,
        model: message.model,
        providerSlug: message.providerSlug,
        usage: message.usage,
        blockedReason: message.blockedReason,
        error: message.error,
        ...(message.truncation !== undefined
          ? { truncation: message.truncation }
          : {}),
      });
    },
    async streamProgress(update) {
      const nowMs = Date.now();
      // Throttled writes still answer the cancel poll: skipped intervals
      // repeat the last verdict, so a cancel is seen at most one interval
      // late and never missed. A `flush` write (the tool-round tail reset)
      // skips the throttle — it must land before the round's parts do.
      if (
        update.flush !== true &&
        nowMs - lastStreamWriteAt < STREAM_WRITE_INTERVAL_MS
      ) {
        return { cancelRequested: lastCancelRequested };
      }
      lastStreamWriteAt = nowMs;
      const progress = await ctx.runMutation(
        internal.chat.generations.streamProgressInternal,
        {
          organizationId: update.organizationId,
          threadId: update.threadId,
          messageId: update.messageId,
          text: update.text,
          ...(update.reasoning !== undefined
            ? { reasoning: update.reasoning }
            : {}),
        },
      );
      lastCancelRequested = progress.cancelRequested;
      return progress;
    },
    async updateAssistantParts(update) {
      await ctx.runMutation(
        internal.chat.messages.updateAssistantPartsInternal,
        {
          organizationId: update.organizationId,
          messageId: update.messageId,
          parts: [...update.parts],
        },
      );
    },
    async finalizeAssistantMessage(message) {
      const messageId = message.messageId;
      await ctx.runMutation(
        internal.chat.messages.finalizeAssistantMessageInternal,
        {
          organizationId: message.organizationId,
          messageId,
          ...(message.text !== undefined ? { finalText: message.text } : {}),
          ...(message.reasoning !== undefined
            ? { reasoning: message.reasoning }
            : {}),
          ...(message.parts !== undefined ? { parts: [...message.parts] } : {}),
          ...(message.model !== undefined ? { model: message.model } : {}),
          ...(message.providerSlug !== undefined
            ? { providerSlug: message.providerSlug }
            : {}),
          ...(message.usage !== undefined ? { usage: message.usage } : {}),
          ...(message.blockedReason !== undefined
            ? { blockedReason: message.blockedReason }
            : {}),
          ...(message.error !== undefined ? { error: message.error } : {}),
        },
      );
    },
    async beginGeneration(generation) {
      await ctx.runMutation(
        internal.chat.generations.beginGenerationInternal,
        generation,
      );
    },
    async endGeneration(generation) {
      await ctx.runMutation(
        internal.chat.generations.endGenerationInternal,
        generation,
      );
    },
  };
}

/**
 * A usage ledger that records each turn into the organization's usage ledger,
 * the same table every other billable call accumulates into. The chosen
 * model's pricing is captured at construction so the ledger can turn the
 * turn's token counts into a cost estimate — via `estimateCostCents`, the
 * same formula the pipeline stamps onto the message's usage.
 */
export function createConvexUsageLedger(
  ctx: ActionCtx,
  options: { pricing?: ModelCatalogEntry['pricing']; teamId?: string } = {},
): UsageLedger {
  return {
    async record(entry) {
      await ctx.runMutation(
        internal.governance.internal_mutations.incrementUsageLedger,
        {
          organizationId: entry.organizationId,
          userId: entry.userId,
          teamId: options.teamId,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          costEstimateCents: estimateCostCents(
            entry.inputTokens,
            entry.outputTokens,
            options.pricing,
          ),
          timestamp: Date.now(),
          agentSlug: entry.agentSlug,
          model: entry.model,
          provider: entry.provider,
        },
      );
    },
  };
}
