'use node';

/**
 * Integration → agents + schedules cascade coordinator, run on either edge of a
 * credential's connected state. Scheduled from `credential_mutations.ts` (V8
 * mutations can't call a `'use node'` action directly).
 *
 * On `disable`, every agent that HARD-requires the integration
 * (`metadata.requires.integrations`) is disabled. On `enable`, only what the
 * cascade disabled is restored — a user's explicit disable is never
 * resurrected — and the schedules of the automations BOUND to the integration
 * are reconciled from their manifests. That reconcile is what lets an
 * automation be installed against a not-yet-connected integration WITHOUT a
 * cron: rather than firing a doomed run every tick until an operator supplies
 * the login, it gets its schedule the moment the integration first connects.
 * For everything already running it is a heal, and it is pause-preserving —
 * `reconcileAutomationSchedules` converges an existing row's variables/timezone
 * and never touches its `isActive`, so a schedule an operator paused stays
 * paused across a disconnect/reconnect cycle.
 */

import { v } from 'convex/values';

import { getString, isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import { type ActionCtx, internalAction } from '../_generated/server';
import {
  invalidateAgentListCache,
  listAgentsForOrg,
} from '../agents/internal_actions';
import { syncAutomationSchedules } from '../automations/install_actions';
import { readAutomationBundleManifest } from '../automations/install_fs';
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

/**
 * Reconcile the schedules of every automation bound to `slug` from its manifest.
 * Best-effort per automation: a bundle whose source no longer resolves is logged
 * and skipped rather than failing the whole cascade (the agent half has already
 * run, and a reconnect must not half-apply).
 */
async function reconcileBoundSchedules(
  ctx: ActionCtx,
  organizationId: string,
  orgSlug: string,
  slug: string,
): Promise<number> {
  const bound = await ctx.runQuery(
    internal.automations.install_mutations
      .listInstallationsRequiringIntegrationInternal,
    { organizationId, integrationSlug: slug },
  );
  let reconciled = 0;
  for (const { automationSlug } of bound) {
    try {
      const manifest = await readAutomationBundleManifest(
        orgSlug,
        automationSlug,
      );
      await syncAutomationSchedules(
        ctx,
        organizationId,
        automationSlug,
        manifest,
      );
      reconciled += 1;
    } catch (error) {
      console.error(
        `[IntegrationCascade] schedule reconcile for automation "${automationSlug}" failed:`,
        error,
      );
    }
  }
  return reconciled;
}

export const cascadeIntegration = internalAction({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    mode: v.union(v.literal('disable'), v.literal('enable')),
  },
  returns: v.object({ agents: v.number(), schedules: v.number() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ agents: number; schedules: number }> => {
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

    // Only the reconnect edge provisions schedules. Disconnect deliberately
    // leaves them alone: a cron whose integration is down fails visibly, and
    // silently deactivating rows here would need a "who paused this" marker to
    // avoid resurrecting an operator's own pause on the way back up.
    const schedules =
      args.mode === 'enable'
        ? await reconcileBoundSchedules(
            ctx,
            args.organizationId,
            orgSlug,
            args.slug,
          )
        : 0;

    invalidateAgentListCache(orgSlug);
    console.log('[IntegrationCascade]', {
      org: args.organizationId,
      slug: args.slug,
      mode: args.mode,
      agents: agentSlugs.length,
      schedules,
    });
    return { agents: agentSlugs.length, schedules };
  },
});
