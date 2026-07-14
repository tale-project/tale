'use node';

/**
 * Integration → agents cascade coordinator. When an integration is
 * disconnected, every agent that HARD-requires it
 * (`metadata.requires.integrations`) is disabled. On reconnect, only what the
 * cascade disabled is restored — a user's explicit disable is never
 * resurrected. Scheduled from `credential_mutations.ts` on credential status
 * changes (V8 mutations can't call a `'use node'` action directly).
 */

import { v } from 'convex/values';

import { getString, isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import {
  invalidateAgentListCache,
  listAgentsForOrg,
} from '../agents/internal_actions';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';

/** Agents that HARD-require `slug` via metadata.requires.integrations. */
async function requiringAgentSlugs(
  orgSlug: string,
  slug: string,
): Promise<string[]> {
  const roster = await listAgentsForOrg(orgSlug);
  const out: string[] = [];
  for (const entry of roster) {
    if (!isRecord(entry)) continue;
    const agentSlug = getString(entry, 'slug') ?? getString(entry, 'name');
    if (!agentSlug) continue;
    const meta = entry.metadata;
    const requires =
      isRecord(meta) && isRecord(meta.requires)
        ? meta.requires.integrations
        : undefined;
    if (Array.isArray(requires) && requires.includes(slug)) {
      out.push(agentSlug);
    }
  }
  return out;
}

export const cascadeIntegration = internalAction({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    mode: v.union(v.literal('disable'), v.literal('enable')),
  },
  returns: v.object({ agents: v.number() }),
  handler: async (ctx, args): Promise<{ agents: number }> => {
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);

    // Agents that hard-require this integration.
    const agentSlugs = await requiringAgentSlugs(orgSlug, args.slug);

    for (const agentSlug of agentSlugs) {
      if (args.mode === 'disable') {
        await ctx.runMutation(internal.agents.installations.setEnabled, {
          organizationId: args.organizationId,
          agentSlug,
          enabled: false,
          disabledReason: 'integration_disabled',
        });
      } else {
        await ctx.runMutation(
          internal.integrations.cascade_mutations.reEnableIfCascadeDisabled,
          { organizationId: args.organizationId, agentSlug },
        );
      }
    }

    invalidateAgentListCache(orgSlug);
    console.log('[IntegrationCascade]', {
      org: args.organizationId,
      slug: args.slug,
      mode: args.mode,
      agents: agentSlugs.length,
    });
    return { agents: agentSlugs.length };
  },
});
