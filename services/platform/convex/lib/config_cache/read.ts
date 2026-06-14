import type { GenericDatabaseReader } from 'convex/server';

import type { DataModel } from '../../_generated/dataModel';

/** The readable subset of a `configCache` row (the file-derived mirror that
 *  V8 readers consult). */
export interface ConfigCacheRow {
  config: unknown;
  enabled?: boolean;
  effectiveAt?: number;
}

/**
 * Read the effective cached config for `(organizationId, domain, key)`.
 *
 * The source of truth is the per-org JSON files under
 * `$TALE_CONFIG_DIR/<orgSlug>/<domain>/`, mirrored into the `configCache` table
 * by `lib/config_cache/actions.ts::syncConfigDomainFromFiles` (on every write +
 * on scaffold/reseed) so V8 code — which cannot read the filesystem — has a
 * synchronous read path. Returns `null` on a cache miss; callers fall back to
 * the schema default, exactly as they did for a missing row before the cache.
 *
 * Takes `db` (a `GenericDatabaseReader`) rather than a query ctx so both query
 * and mutation/better-auth-hook call sites can share it (a mutation's
 * `DatabaseWriter` is assignable to `DatabaseReader`).
 */
export async function readConfigCacheRow(
  db: GenericDatabaseReader<DataModel>,
  organizationId: string,
  domain: string,
  key: string,
): Promise<ConfigCacheRow | null> {
  const row = await db
    .query('configCache')
    .withIndex('by_org_domain_key', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('domain', domain)
        .eq('key', key),
    )
    .first();
  if (!row) return null;
  return {
    config: row.config,
    enabled: row.enabled,
    effectiveAt: row.effectiveAt,
  };
}
