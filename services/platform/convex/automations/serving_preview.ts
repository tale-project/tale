'use node';

/**
 * What an UNPINNED agent-node model pick would run on RIGHT NOW.
 *
 * The node editor must display the provider a run would actually use, and
 * the only non-drifting source of that answer is the runtime's own resolver
 * — so this action asks {@link resolveWorkflowAgentServing} with no pin,
 * exactly as the stepper's kick would for a pinless node. The answer is a
 * snapshot, not a promise: connectors, credentials, and allowlists move it,
 * which is precisely why the editor offers pinning.
 *
 * A resolution failure is a RESULT here, not an error — "nothing serves this
 * model" is what the editor needs to render, and the resolver's own message
 * names the reason the way it would fail a run.
 */

import { v } from 'convex/values';

import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { resolveWorkflowAgentServing } from '../lib/providers/agent_serving';

export const previewUnpinnedAgentServing = action({
  args: {
    organizationId: v.string(),
    model: v.string(),
    /** The node's EFFECTIVE harness (the host default when the field is
     * unset) — subscription servings are sanctioned per harness. */
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
      const serving = await resolveWorkflowAgentServing(ctx, {
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
