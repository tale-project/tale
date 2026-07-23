import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../validators/json';

/**
 * Derived read-through cache of file-based config for `v8-sync` domains.
 *
 * **Not authoritative.** The source of truth is the per-org config files
 * under `$TALE_CONFIG_DIR/<orgSlug>/<domain>/`. V8 queries / mutations /
 * better-auth hooks cannot read the filesystem, so they read this generic
 * mirror instead. It is rebuilt from the files by
 * `lib/config_cache/actions.ts` on every write and on scaffold/reseed (plus
 * a periodic reconcile), and can be re-derived at any time.
 *
 * Domain-agnostic by design:
 *  - `domain` names the config domain (`'governance'`, `'sso'`, …),
 *  - `key` the item within it (a governance `policyType`, …),
 *  - `config` holds the EFFECTIVE, schema-normalized config,
 *  - `effectiveAt` is a generic enforcement anchor (e.g. the
 *    password-rotation grace anchor) preserved across re-syncs.
 */
export const configCacheTable = defineTable({
  organizationId: v.string(),
  domain: v.string(),
  key: v.string(),
  config: jsonRecordValidator,
  enabled: v.optional(v.boolean()),
  effectiveAt: v.optional(v.number()),
  /** ms since epoch of the last file→cache sync for this row. */
  syncedAt: v.number(),
})
  .index('by_org_domain', ['organizationId', 'domain'])
  .index('by_org_domain_key', ['organizationId', 'domain', 'key'])
  // Cross-org range over one (domain, key) — lets "every org's value of X"
  // readers (retention / session-idle enforcement) range instead of scanning.
  .index('by_domain_key', ['domain', 'key']);
