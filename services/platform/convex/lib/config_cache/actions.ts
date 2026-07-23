'use node';

/**
 * Generic file→`configCache` sync for `v8-sync` config domains.
 *
 * The source of truth is the per-org config tree at
 * `$TALE_CONFIG_DIR/<orgSlug>/<domain>/`. V8 code can't read the filesystem,
 * so this `'use node'` action reads each domain key from the org's OWN files
 * (never a cross-org fallback) and mirrors it into the non-authoritative
 * `configCache` table. Driven by the registry `V8SyncSpec` (Layer A) + the
 * domain dir resolvers (Layer B).
 *
 * Each key is read through the shared domain-file helper: `<fileBase>.yml`
 * first, `<fileBase>.json` as the fallback while org trees are converted to
 * YAML org by org.
 */

import { v } from 'convex/values';

import {
  getV8SyncSpec,
  type V8SyncSpec,
} from '../../../lib/shared/config/registry';
import { zodErrorMessage } from '../../../lib/shared/schemas/format-error';
import { isRecord } from '../../../lib/utils/type-utils';
import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { readDomainConfigFile } from '../config_store/read_domain_file';
import { resolveDomainDir } from '../config_store/resolvers';
import { orgSlugFromId } from '../helpers/org_slug';

const MAX_FILE_SIZE_BYTES = 256 * 1024;

/**
 * Read the config file for `(domain, key)` under `orgSlug` — the org's own
 * file only. Returns the schema-normalized config record, or `null` when the
 * org has no such file — a genuine cache miss the reader resolves via its
 * schema default (a code baseline, never another org's config).
 */
async function readEffectiveConfig(
  domain: string,
  orgSlug: string,
  key: string,
  spec: V8SyncSpec,
): Promise<Record<string, unknown> | null> {
  const schema = spec.schemaFor(key);
  const fileBase = spec.fileBaseFor(key);
  const result = await readDomainConfigFile(
    resolveDomainDir(domain, orgSlug),
    fileBase,
    MAX_FILE_SIZE_BYTES,
    (data) => {
      const outcome = schema.safeParse(data);
      if (!outcome.success) {
        throw new Error(
          zodErrorMessage(`Invalid ${domain}/${key} config`, outcome.error),
        );
      }
      return outcome.data;
    },
  );
  if (result.ok) {
    return isRecord(result.data) ? result.data : null;
  }
  if (result.error !== 'not_found') {
    // Corrupt/oversized file: treated as a cache miss (reader uses the schema
    // default) but loudly logged — the file is the source of truth.
    console.error(
      `[config_cache] failed to read ${orgSlug}/${domain}/${fileBase}: ${result.message}`,
    );
  }
  return null;
}

/** `config.enabled` when boolean, else undefined (column stays unset). */
function extractEnabled(config: Record<string, unknown>): boolean | undefined {
  return typeof config.enabled === 'boolean' ? config.enabled : undefined;
}

/**
 * Re-read every config file for a `v8-sync` domain and replace that org's
 * `configCache` rows. Idempotent; safe after any write and on scaffold or
 * reseed. Resolves the on-disk slug from `organizationId` server-side —
 * never trusted from a client.
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
