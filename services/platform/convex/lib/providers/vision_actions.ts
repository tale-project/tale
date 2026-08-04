'use node';

/**
 * Read surface for the vision polyfill's model choice — what the governance
 * editor shows next to the Auto option.
 *
 * The pick is otherwise invisible: three lanes resolve it at run time (task
 * agent, automation agent node, chat `run_code`) and none of them records it
 * anywhere a reader can reach, which is why a misrouted auto-pick had to be
 * diagnosed from the gateway's request log. This action answers "which model
 * would read an image for us right now, and why that one".
 *
 * Gated like the provider catalog it reads from — the same admin/developer
 * surface as the credentials that make a model reachable in the first place.
 */

import { v } from 'convex/values';

import { action } from '../../_generated/server';
import { requireOrgAdminOrDeveloper } from '../auth/require_org_admin_or_developer';
import { resolveOrgVisionModel } from './resolve_vision_model';

export const getResolvedVisionModel = action({
  args: { organizationId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      providerSlug: v.string(),
      modelId: v.string(),
      source: v.union(
        v.literal('pinned'),
        v.literal('preferred'),
        v.literal('cheapest'),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    // Best-effort like every other read of this lane: an unreachable catalog
    // reads as "no vision model" rather than failing the settings page.
    try {
      return await resolveOrgVisionModel(ctx, args.organizationId);
    } catch (err) {
      console.warn(
        '[vision-model] resolved-pick lookup failed (settings shows it as unavailable):',
        err,
      );
      return null;
    }
  },
});
