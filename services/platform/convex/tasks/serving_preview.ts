'use node';

/**
 * What an UNPINNED project-agent model pick would run on RIGHT NOW.
 *
 * The agent dialog must display the provider a run would actually use, and
 * the only non-drifting source of that answer is the task lane's own
 * resolver — so this action asks {@link resolveTaskServing} with no pin,
 * exactly as the run host would for a pinless agent. The task lane's
 * unpinned walk is DIRECT-ONLY (unlike the automation lane's two-pass), so
 * the two surfaces each ask their own lane instead of sharing a guess.
 *
 * A resolution failure is a RESULT here, not an error — "nothing serves this
 * model" is what the dialog needs to render, and the resolver's own message
 * names the reason the way it would fail a run.
 */

import { v } from 'convex/values';

import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { resolveTaskServing } from './task_serving';

export const previewUnpinnedTaskServing = action({
  args: {
    organizationId: v.string(),
    model: v.string(),
    /** The agent's harness — kept in the contract for parity with the pinned
     * split even though the unpinned direct walk ignores it. */
    harness: v.string(),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      providerSlug: v.string(),
      /** The catalog id the serving provider lists the model under — the
       * vendor-prefixed ref on an aggregator, the bare id elsewhere. */
      modelId: v.string(),
      lane: v.union(v.literal('gateway'), v.literal('subscription')),
    }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx, args) => {
    await requireOrgMembershipById(ctx, args.organizationId);
    try {
      const serving = await resolveTaskServing(ctx, {
        organizationId: args.organizationId,
        model: args.model,
        harness: args.harness,
      });
      return {
        ok: true as const,
        providerSlug: serving.providerSlug,
        modelId: serving.modelId,
        lane: serving.lane,
      };
    } catch (error) {
      return {
        ok: false as const,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
