'use node';

/**
 * The single entry point for refreshing an org's `configCache` from files.
 *
 * Iterates the registry's `v8-sync` domains and re-syncs each. Wired into
 * org-create, reseed, governance writes, the dev file watcher, and the
 * hourly cron reconcile — so the cache stays in lockstep with the files
 * (the source of truth) from every angle.
 */

import { v } from 'convex/values';

import { V8_SYNC_DOMAINS } from '../../../lib/shared/config/registry';
import { getString, isRecord } from '../../../lib/utils/type-utils';
import { components, internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';

export const syncOrgConfigCaches = internalAction({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    for (const domain of V8_SYNC_DOMAINS) {
      await ctx.runAction(
        internal.lib.config_cache.actions.syncConfigDomainFromFiles,
        { organizationId: args.organizationId, domain: domain.name },
      );
    }
    return null;
  },
});

/**
 * Periodic reconcile (cron): re-derive every registered org's `configCache`
 * from files. The cache is re-derivable, so this is a cheap safety net
 * guaranteeing eventual convergence if a write trigger is ever missed.
 * Best-effort per org — one org's failure never aborts the sweep.
 * Enumerates Better Auth `organization` rows (cursor-paginated).
 */
export const reconcileAllConfigCaches = internalAction({
  args: {},
  returns: v.object({ orgs: v.number() }),
  handler: async (ctx): Promise<{ orgs: number }> => {
    let cursor: string | null = null;
    let prevCursor: string | null | undefined;
    let isDone = false;
    let orgs = 0;
    const MAX_PAGES = 1000;
    let pages = 0;
    while (!isDone) {
      if (pages++ >= MAX_PAGES) {
        console.warn('[reconcileConfigCaches] page cap hit; stopping');
        break;
      }
      // A cursor that stops advancing would loop forever — bail loudly.
      if (prevCursor !== undefined && cursor === prevCursor) {
        console.warn(
          '[reconcileConfigCaches] cursor did not advance; stopping',
        );
        break;
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
        const orgId = getString(raw, '_id');
        if (!orgId) continue;
        try {
          await ctx.runAction(
            internal.lib.config_cache.sync_org.syncOrgConfigCaches,
            { organizationId: orgId },
          );
          orgs += 1;
        } catch (error) {
          console.warn(
            `[reconcileConfigCaches] org ${orgId} failed (re-derivable):`,
            error instanceof Error ? error.message : error,
          );
        }
      }
      cursor =
        isRecord(res) && typeof res.continueCursor === 'string'
          ? res.continueCursor
          : null;
      isDone =
        isRecord(res) && typeof res.isDone === 'boolean' ? res.isDone : true;
    }
    return { orgs };
  },
});
