'use node';

/**
 * Provision the default task-ops workflow pack to EXISTING organizations
 * (new orgs get it from the org-creation hook). Idempotent — per-workflow
 * `wfDefaultProvisions` rows make re-runs no-ops, and orgs that uninstalled
 * or deactivated a pack workflow are never re-provisioned behind their back.
 *
 * Two entry points:
 *  - `provisionTaskOpsPackAllOrgs` — registered in `migrations.ts:runAll`,
 *    which the deploy entrypoint executes: the pack comes PREINSTALLED with
 *    active triggers for every org on every deploy, no rollout step.
 *  - `provisionTaskOpsPack` — single-org ops tool:
 *    bunx convex run migrations/provision_task_ops_pack:provisionTaskOpsPack \
 *      '{ "organizationId": "<org-id>", "orgSlug": "<org-slug>" }'
 */

import { v } from 'convex/values';

import { isValidOrgSlug } from '../../lib/shared/constants/org-slug';
import { getString, isRecord } from '../../lib/utils/type-guards';
import { components, internal } from '../_generated/api';
import { internalAction } from '../_generated/server';

export const provisionTaskOpsPack = internalAction({
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
      internal.workflows.provision_defaults.syncDefaultWorkflowInstallations,
      { organizationId: args.organizationId, orgSlug: args.orgSlug },
    );
    console.log('[TaskOpsProvision] migration run', {
      organizationId: args.organizationId,
      ...result,
    });
    return result;
  },
});

export const provisionTaskOpsPackAllOrgs = internalAction({
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
          `provisionTaskOpsPackAllOrgs: pagination did not terminate within ${MAX_PAGES} pages`,
        );
      }
      if (prevCursor !== undefined && cursor === prevCursor) {
        throw new Error(
          'provisionTaskOpsPackAllOrgs: pagination cursor did not advance',
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
          internal.workflows.provision_defaults
            .syncDefaultWorkflowInstallations,
          { organizationId: org.id, orgSlug: org.slug },
        );
        provisioned += result.provisioned;
      } catch (error) {
        // One broken org must not block the fleet; the next deploy retries.
        failedOrgs += 1;
        console.error('[TaskOpsProvision] org provisioning failed', {
          orgSlug: org.slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    console.log('[TaskOpsProvision] all-orgs run', {
      orgs: orgs.length,
      provisioned,
      failedOrgs,
    });
    return { orgs: orgs.length, provisioned, failedOrgs };
  },
});
