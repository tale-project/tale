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

import type { TurnStore, UsageLedger } from '../../lib/chat/turn';
import type { ModelCatalogEntry } from '../../lib/shared/schemas/providers';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';

/** A turn store that writes to the `messages` and `generations` tables. */
export function createConvexTurnStore(ctx: ActionCtx): TurnStore {
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
      });
    },
    async beginGeneration(generation) {
      await ctx.runMutation(
        internal.chat.generations.beginGenerationInternal,
        generation,
      );
    },
    async heartbeat(generation) {
      await ctx.runMutation(
        internal.chat.generations.heartbeatInternal,
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

/** Cost of a turn in cents, from the model's catalog pricing. Absent pricing
 * records zero rather than guessing a rate — an under-count is honest where a
 * fabricated one is not. */
function costCents(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelCatalogEntry['pricing'] | undefined,
): number {
  if (!pricing) return 0;
  return (
    (inputTokens / 1_000_000) * pricing.inputCentsPerMillion +
    (outputTokens / 1_000_000) * pricing.outputCentsPerMillion
  );
}

/**
 * A usage ledger that records each turn into the organization's usage ledger,
 * the same table every other billable call accumulates into. The chosen
 * model's pricing is captured at construction so the ledger can turn the
 * turn's token counts into a cost estimate.
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
          costEstimateCents: costCents(
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
