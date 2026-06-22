'use node';

/**
 * Generic file→`configCache` sync for `v8-sync` config domains.
 *
 * The source of truth is the per-org JSON tree at
 * `$TALE_CONFIG_DIR/<orgSlug>/<domain>/`. V8 code can't read the filesystem, so
 * this `'use node'` action reads each domain key from the org's OWN files (no
 * cross-org fallback) and mirrors it into the non-authoritative `configCache`
 * table that queries/mutations read. Driven by the registry `V8SyncSpec`
 * (Layer A) + the domain dir resolvers (Layer B).
 */

import { v } from 'convex/values';

import {
  getV8SyncSpec,
  type V8SyncSpec,
} from '../../../lib/shared/config/registry';
import { isRecord } from '../../../lib/utils/type-utils';
import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { resolveDomainDir } from '../config_store/resolvers';
import { readJsonFile, safeJoinWithinDir } from '../file_io';
import { orgSlugFromId } from '../helpers/org_slug';

const MAX_FILE_SIZE_BYTES = 256 * 1024;

/**
 * Read a config file for `(domain, key)` under `orgSlug` — the org's OWN file
 * only, no cross-org fallback (every org is fully seeded from the built-in
 * catalog at create). Returns the schema-normalized config record, or `null`
 * when the org has no such file — a genuine cache miss the reader resolves via
 * its schema default (a code baseline, never another org's config).
 */
async function readEffectiveConfig(
  domain: string,
  orgSlug: string,
  key: string,
  spec: V8SyncSpec,
): Promise<Record<string, unknown> | null> {
  const schema = spec.schemaFor(key);
  const fileBase = spec.fileBaseFor(key);
  const filePath = safeJoinWithinDir(
    resolveDomainDir(domain, orgSlug),
    `${fileBase}.json`,
  );
  const result = await readJsonFile(
    filePath,
    MAX_FILE_SIZE_BYTES,
    (content) => {
      const parsed: unknown = JSON.parse(content);
      const r = schema.safeParse(parsed);
      if (!r.success) {
        throw new Error(`Invalid ${domain}/${key} config: ${r.error.message}`);
      }
      return r.data;
    },
  );
  if (result.ok) {
    return isRecord(result.data) ? result.data : null;
  }
  if (result.error !== 'not_found') {
    // Corrupt/oversized file: a genuine cache miss (reader uses schema default).
    console.error(
      `[config_cache] failed to read ${orgSlug}/${domain}/${fileBase}: ${result.message}`,
    );
  }
  return null;
}

/** `config.enabled` when it is a boolean, else undefined (column stays unset). */
function extractEnabled(config: Record<string, unknown>): boolean | undefined {
  return typeof config.enabled === 'boolean' ? config.enabled : undefined;
}

/**
 * Re-read every config file for a `v8-sync` domain and replace that org's
 * `configCache` rows. Idempotent; safe to call after any write and on
 * scaffold/reseed. Resolves the on-disk slug from `organizationId` server-side
 * (never trusted from a client).
 */
export const syncConfigDomainFromFiles = internalAction({
  args: { organizationId: v.string(), domain: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const spec = getV8SyncSpec(args.domain);
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);

    const entries: Array<{
      key: string;
      config: Record<string, unknown>;
      enabled?: boolean;
    }> = [];
    for (const key of spec.keys) {
      const config = await readEffectiveConfig(args.domain, orgSlug, key, spec);
      if (config === null) continue;
      entries.push({ key, config, enabled: extractEnabled(config) });
    }

    await ctx.runMutation(
      internal.lib.config_cache.cache.replaceConfigCacheForOrg,
      {
        organizationId: args.organizationId,
        domain: args.domain,
        syncedAt: Date.now(),
        entries,
      },
    );
    return null;
  },
});
