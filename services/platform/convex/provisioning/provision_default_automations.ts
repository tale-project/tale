'use node';

/**
 * Provision the out-of-the-box automations to EXISTING organizations (new
 * orgs get them from the org-creation hook). Idempotent — per-automation
 * `wfDefaultProvisions` rows make re-runs no-ops, and orgs that uninstalled
 * an autoInstall automation or deactivated its triggers are never
 * re-provisioned behind their back.
 *
 * Two entry points (mirrors `provision_default_agents.ts`):
 *  - `provisionDefaultAutomationsAllOrgs` — registered in
 *    `provisioning.ts:provisionAll`, which the deploy entrypoint executes:
 *    the packs come PREINSTALLED with active triggers for every org on every
 *    deploy, no rollout step.
 *  - `provisionDefaultAutomations` — single-org ops tool:
 *    bunx convex run provisioning/provision_default_automations:provisionDefaultAutomations \
 *      '{ "organizationId": "<org-id>", "orgSlug": "<org-slug>" }'
 */

import { v } from 'convex/values';

import { isValidOrgSlug } from '../../lib/shared/constants/org-slug';
import { getString, isRecord } from '../../lib/utils/type-utils';
import { components, internal } from '../_generated/api';
import { internalAction } from '../_generated/server';

export const provisionDefaultAutomations = internalAction({
  args: {
    organizationId: v.string(),
    orgSlug: v.string(),
  },
  returns: v.object({
    provisioned: v.number(),
    skipped: v.number(),
    failed: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ provisioned: number; skipped: number; failed: number }> => {
    const result = await ctx.runAction(
      internal.automations.provision_defaults
        .syncDefaultAutomationInstallations,
      { organizationId: args.organizationId, orgSlug: args.orgSlug },
    );
    console.log('[AutomationProvision] migration run', {
      organizationId: args.organizationId,
      ...result,
    });
    return result;
  },
});

export const provisionDefaultAutomationsAllOrgs = internalAction({
  args: {},
  returns: v.object({
    orgs: v.number(),
    provisioned: v.number(),
    failedOrgs: v.number(),
  }),
  handler: async (
    ctx,
  ): Promise<{ orgs: number; provisioned: number; failedOrgs: number }> => {
    // Enumerate Better Auth organizations (cursor-paginated; same defensive
    // bounds as reseed_all_orgs).
    const orgs: Array<{ id: string; slug: string }> = [];
    let cursor: string | null = null;
    let prevCursor: string | null | undefined;
    let isDone = false;
    const MAX_PAGES = 1000;
    let pages = 0;
    while (!isDone) {
      if (pages++ >= MAX_PAGES) {
        throw new Error(
          `provisionDefaultAutomationsAllOrgs: pagination did not terminate within ${MAX_PAGES} pages`,
        );
      }
      if (prevCursor !== undefined && cursor === prevCursor) {
        throw new Error(
          'provisionDefaultAutomationsAllOrgs: pagination cursor did not advance',
        );
      }
      prevCursor = cursor;
      const res: unknown = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'organization',
          paginationOpts: { cursor, numItems: 200 },
          where: [],
        },
      );
      const page = isRecord(res) && Array.isArray(res.page) ? res.page : [];
      for (const raw of page) {
        if (!isRecord(raw)) continue;
        const id = getString(raw, '_id') ?? getString(raw, 'id');
        const slug = getString(raw, 'slug');
        if (!id || !slug || !isValidOrgSlug(slug)) continue;
        orgs.push({ id, slug });
      }
      cursor =
        isRecord(res) && typeof res.continueCursor === 'string'
          ? res.continueCursor
          : null;
      isDone =
        isRecord(res) && typeof res.isDone === 'boolean' ? res.isDone : true;
    }

    let provisioned = 0;
    let failedOrgs = 0;
    for (const org of orgs.sort((a, b) => a.slug.localeCompare(b.slug))) {
      try {
        const result = await ctx.runAction(
          internal.automations.provision_defaults
            .syncDefaultAutomationInstallations,
          { organizationId: org.id, orgSlug: org.slug },
        );
        provisioned += result.provisioned;
      } catch (error) {
        // One broken org must not block the fleet; the next deploy retries.
        failedOrgs += 1;
        console.error('[AutomationProvision] org provisioning failed', {
          orgSlug: org.slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    console.log('[AutomationProvision] all-orgs run', {
      orgs: orgs.length,
      provisioned,
      failedOrgs,
    });
    return { orgs: orgs.length, provisioned, failedOrgs };
  },
});
