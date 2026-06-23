'use node';

/**
 * The single entry point for refreshing an org's `configCache` from files.
 *
 * Iterates the registry's `v8-sync` domains and re-syncs each, then re-derives
 * the file-backed Enterprise SSO mirror (a bespoke non-registry domain). Wired
 * into org-create (`auth.afterCreateOrganization`), reseed-all, governance
 * writes, the dev file watcher, and a periodic cron reconcile — so the cache is
 * kept in lockstep with the files (the source of truth) from every angle.
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
    // Enterprise SSO is file-backed and V8-read (login + auth hooks read the
    // `sso` configCache mirror), but is intentionally NOT a registry v8-sync
    // domain — it has no seeded default and lives nested under governance/sso/,
    // so the generic loop above skips it. Re-derive it here, through the same
    // single entry point, so EVERY rebuild path (org-create, reseed-all, the
    // dev file watcher, the periodic cron reconcile) keeps the SSO mirror in
    // lockstep with `connection.json` (the source of truth). Without this a
    // configCache loss — fresh DB over existing files, a partial restore —
    // would strand SSO sign-in until an admin re-saved. Idempotent; a no-op for
    // an org with no connection file.
    await ctx.runAction(
      internal.enterprise_sso.config.file_actions.syncConnectionCache,
      { organizationId: args.organizationId },
    );
    return null;
  },
});

/**
 * Periodic reconcile (cron): re-derive every registered org's `configCache`
 * from files. Files are the source of truth and the cache is re-derivable, so
 * this is a cheap safety net guaranteeing eventual convergence even if a write
 * trigger is ever missed. Best-effort per org — one org's failure never aborts
 * the sweep. Enumerates Better Auth `organization` rows (cursor-paginated).
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
        } catch (err) {
          console.warn(
            `[reconcileConfigCaches] org ${orgId} failed (re-derivable):`,
            err instanceof Error ? err.message : err,
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
