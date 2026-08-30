import type { DatabaseReader } from '../../_generated/server';

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
 * The source of truth is the per-org config files; this table is the mirror
 * maintained by `lib/config_cache/actions.ts`. Returns `null` on a cache
 * miss — callers fall back to their schema default, never to another org's
 * value.
 *
 * Takes a `GenericDatabaseReader` rather than a query ctx so query,
 * mutation, and better-auth-hook call sites can all share it (a mutation's
 * `DatabaseWriter` is assignable to `DatabaseReader`).
 */
export async function readConfigCacheRow(
  db: DatabaseReader,
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
