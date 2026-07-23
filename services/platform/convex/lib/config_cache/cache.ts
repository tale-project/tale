import { v } from 'convex/values';

import { internalMutation } from '../../_generated/server';
import { jsonRecordValidator } from '../validators/json';

/**
 * Replace the derived `configCache` rows for one `(org, domain)` from a fresh
 * file snapshot. Called by `lib/config_cache/actions.ts` (the `'use node'`
 * action that reads the files) — this V8 mutation only touches the DB.
 *
 * Upserts each entry by `(organizationId, domain, key)` and prunes rows whose
 * key is absent from the snapshot, so deleting a config file clears its
 * cached effective config. Last-writer-wins: the cache is non-authoritative
 * and re-derivable, so a lost race self-heals on the next sync.
 */
export const replaceConfigCacheForOrg = internalMutation({
  args: {
    organizationId: v.string(),
    domain: v.string(),
    syncedAt: v.number(),
    entries: v.array(
      v.object({
        key: v.string(),
        config: jsonRecordValidator,
        enabled: v.optional(v.boolean()),
        effectiveAt: v.optional(v.number()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const incoming = new Set(args.entries.map((entry) => entry.key));

    const existing = await ctx.db
      .query('configCache')
      .withIndex('by_org_domain', (q) =>
        q.eq('organizationId', args.organizationId).eq('domain', args.domain),
      )
      .collect();
    const byKey = new Map(existing.map((row) => [row.key, row]));

    for (const entry of args.entries) {
      const current = byKey.get(entry.key);
      // `effectiveAt` is enforcement STATE (e.g. the password-rotation grace
      // anchor), not file config: a re-sync that merely re-mirrors config must
      // not reset it. Preserve the stored value unless the writer explicitly
      // supplies a new one.
      const effectiveAt = entry.effectiveAt ?? current?.effectiveAt;
      const patch = {
        config: entry.config,
        enabled: entry.enabled,
        effectiveAt,
        syncedAt: args.syncedAt,
      };
      if (current) {
        await ctx.db.patch(current._id, patch);
      } else {
        await ctx.db.insert('configCache', {
          organizationId: args.organizationId,
          domain: args.domain,
          key: entry.key,
          ...patch,
        });
      }
    }

    // Prune rows for keys no longer present on disk.
    for (const row of existing) {
      if (!incoming.has(row.key)) {
        await ctx.db.delete(row._id);
      }
    }

    return null;
  },
});

/**
 * Set (or clear) the `effectiveAt` enforcement anchor on a single cache row.
 * Used by enforcement-bearing writes that must stamp a grace window when a
 * setting first transitions to an active value (e.g. password rotation
 * 0 → positive) without rewriting `config`. A missing row is a no-op — the
 * next sync materializes it.
 */
export const setConfigCacheEffectiveAt = internalMutation({
  args: {
    organizationId: v.string(),
    domain: v.string(),
    key: v.string(),
    effectiveAt: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('configCache')
      .withIndex('by_org_domain_key', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('domain', args.domain)
          .eq('key', args.key),
      )
      .first();
    if (row) {
      await ctx.db.patch(row._id, {
        effectiveAt: args.effectiveAt ?? undefined,
      });
    }
    return null;
  },
});
