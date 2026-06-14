/**
 * Canonical config-domain registry — the single source of truth for the set
 * of file-based config domains the platform loads from
 * `$TALE_CONFIG_DIR/<orgSlug>/<domain>/`.
 *
 * # Why this exists
 *
 * Every config domain is loaded from JSON files on disk (files are ALWAYS the
 * source of truth). The list of domains was previously duplicated across
 * `convex/organizations/scaffold.ts` (the scaffold `DOMAINS` array),
 * `lib/config-watcher.ts` (the watcher `typeMap`), and the governance schema —
 * each with its own copy that had to "stay in lockstep" by comment. This module
 * collapses them into one declarative list every consumer reads from.
 *
 * # The two-layer split (Convex V8↔Node bundling boundary)
 *
 * A Convex query/mutation runs in a V8 sandbox that cannot import `node:*`; a
 * `'use node'` module that touches the filesystem (every `<domain>/file_utils.ts`,
 * `lib/file_io.ts`, `scaffold.ts`) therefore cannot be value-imported by V8
 * code. The standalone platform `server.ts` (which bundles `config-watcher.ts`)
 * has the same constraint for the Convex client side.
 *
 * So the registry is **Layer A**: pure data + Zod + pure string helpers, with
 * NO `node:*`, NO `convex/_generated`, NO `'use node'`. It is import-safe from
 * V8 Convex code, from `'use node'` actions, and from the platform server.
 * The filesystem path resolvers (`resolve<Domain>Dir`) live in **Layer B**:
 * `convex/lib/config_store/resolvers.ts` (`'use node'`), keyed by `name`.
 */

import type { z } from 'zod/v4';

import {
  FILE_POLICY_TYPES,
  isFilePolicyType,
  POLICY_SCHEMAS,
  policyTypeToFileBase,
} from '../schemas/governance';

/**
 * On-disk shape of a domain's catalog/data dir:
 *  - `flat`        — one file per item, no subdirs (agents, providers, prompts, governance).
 *  - `bundle`      — one dir per item (skills, integrations).
 *  - `tree`        — arbitrary nested files (workflows, branding + images/).
 *  - `single-file` — exactly one file for the whole area (retention). Not a
 *                    top-level scaffold domain — folded into its parent domain.
 */
export type ConfigLayout = 'flat' | 'bundle' | 'tree' | 'single-file';

/**
 * Scaffold/override copy semantics (mirrors the historical `DOMAINS.kind`):
 *  - `flat`   — per-file atomicWrite; user-added files + secrets + `.history/` survive.
 *  - `bundle` — per-item dir replace (staging + atomic rename); domain-root siblings survive.
 *  - `tree`   — per-file overwrite, no rm; user-only folders survive.
 */
export type ScaffoldKind = 'flat' | 'bundle' | 'tree';

/**
 * How a domain's config is READ at runtime — the crux of the architecture:
 *  - `node-direct` — read from the filesystem inside a `'use node'` action.
 *  - `v8-action`   — a V8 action delegates to a `'use node'` action via
 *                    `ctx.runAction` (the retention pattern).
 *  - `v8-sync`     — read from V8 queries/mutations/auth-hooks (which cannot
 *                    touch the filesystem), so files are mirrored into the
 *                    derived `configCache` table and read from there.
 */
export type ReadContext = 'node-direct' | 'v8-action' | 'v8-sync';

/**
 * Where the AUTHORITATIVE copy lives:
 *  - `config`           — the file is the source of truth; the DB only ever
 *                         holds a re-derivable cache (`configCache`).
 *  - `seeded-user-data` — the file is a one-time catalog SEED; the live entity
 *                         is a user-editable DB row (prompts → `promptTemplates`).
 *  - `runtime-state`    — the file holds the definition (source of truth); the
 *                         DB holds only per-org runtime state, never the config
 *                         (workflows → `wfInstallations` + trigger rows).
 */
export type ConfigDataModel = 'config' | 'seeded-user-data' | 'runtime-state';

/**
 * Drives the generic file→`configCache` mirror for `v8-sync` domains. Pure
 * (no fs): the `'use node'` sync action joins `fileBaseFor(key)` onto the
 * domain dir (resolved via Layer B) to find each file.
 */
export interface V8SyncSpec {
  /** Stable cache keys for this domain (the `key` column of `configCache`). */
  readonly keys: readonly string[];
  /** key → Zod schema, used to validate before mirroring AND on read. */
  schemaFor: (key: string) => z.ZodType;
  /** key → on-disk filename base (no extension), relative to the domain dir. */
  fileBaseFor: (key: string) => string;
}

/**
 * Drives the dev file-watcher → frontend SSE cache-invalidation for domains
 * read via Convex ACTIONS (which aren't reactive, so a file edit needs an
 * explicit invalidation signal). Pure string ops (no fs). Omitted for domains
 * that don't need SSE invalidation: `v8-sync` domains are read through reactive
 * Convex queries on `configCache` (the write-path sync updates them
 * automatically), and `prompts` is DB-authoritative seeded data.
 */
export interface DomainWatcherSpec {
  /** SSE event `type` emitted to the frontend for a change in this domain. */
  readonly eventType: string;
  /** A write to `relPathWithinDomain` emits only if this passes (e.g. `.json`
   *  only; skills emit on any bundle file). */
  emitsFor: (relPathWithinDomain: string) => boolean;
  /** Derive the change `slug` from the path segments below the domain dir.
   *  `undefined` → an org-level event with no slug (e.g. branding). */
  slugFromRest: (rest: readonly string[]) => string | undefined;
}

export interface ConfigDomain {
  /** Catalog dir name AND on-disk domain dir: `<orgSlug>/<name>/`. */
  readonly name: string;
  readonly layout: ConfigLayout;
  readonly readContext: ReadContext;
  readonly dataModel: ConfigDataModel;
  /**
   * Scaffold copy semantics. Present iff this domain is independently
   * scaffolded from the builtin catalog (every entry below has one today).
   */
  readonly scaffoldKind: ScaffoldKind;
  /** Present iff `readContext === 'v8-sync'`. */
  readonly v8Sync?: V8SyncSpec;
  /** Present iff dev edits to this domain need a frontend SSE invalidation. */
  readonly watcher?: DomainWatcherSpec;
}

const JSON_ONLY = (p: string): boolean => p.endsWith('.json');
const stripJson = (s: string | undefined): string | undefined =>
  s?.replace(/\.json$/, '');

/**
 * The canonical list. Order matters: `scaffoldNewOrganization` seeds domains in
 * this order, so keep it stable.
 */
export const CONFIG_DOMAINS: readonly ConfigDomain[] = [
  {
    name: 'agents',
    layout: 'flat',
    readContext: 'node-direct',
    dataModel: 'config',
    scaffoldKind: 'flat',
    // <org>/agents/<name>.json
    watcher: {
      eventType: 'agents',
      emitsFor: JSON_ONLY,
      slugFromRest: (rest) => stripJson(rest[0]),
    },
  },
  // Default prompt-library catalog. Flat JSON files; `autoInstall` entries are
  // seeded as `promptTemplates` rows post-scaffold (DB-authoritative user data).
  // No watcher: prompts are DB-authoritative, not read live from files.
  {
    name: 'prompts',
    layout: 'flat',
    readContext: 'node-direct',
    dataModel: 'seeded-user-data',
    scaffoldKind: 'flat',
  },
  {
    name: 'providers',
    layout: 'flat',
    readContext: 'node-direct',
    dataModel: 'config',
    scaffoldKind: 'flat',
    // <org>/providers/<name>.json
    watcher: {
      eventType: 'providers',
      emitsFor: JSON_ONLY,
      slugFromRest: (rest) => stripJson(rest[0]),
    },
  },
  {
    name: 'integrations',
    layout: 'bundle',
    readContext: 'node-direct',
    dataModel: 'config',
    scaffoldKind: 'bundle',
    // <org>/integrations/<slug>/config.json (or other bundle files)
    watcher: {
      eventType: 'integrations',
      emitsFor: JSON_ONLY,
      slugFromRest: (rest) => rest[0],
    },
  },
  // Workflow DEFINITION is the file (source of truth); `wfInstallations` +
  // trigger rows are per-org runtime state, not config.
  {
    name: 'workflows',
    layout: 'tree',
    readContext: 'node-direct',
    dataModel: 'runtime-state',
    scaffoldKind: 'tree',
    // <org>/workflows/[folder/]<name>.json — slug is the path without extension
    watcher: {
      eventType: 'workflows',
      emitsFor: JSON_ONLY,
      slugFromRest: (rest) => stripJson(rest.join('/')),
    },
  },
  {
    name: 'skills',
    layout: 'bundle',
    readContext: 'node-direct',
    dataModel: 'config',
    scaffoldKind: 'bundle',
    // <org>/skills/<slug>/SKILL.md (or any asset) — emit at slug granularity
    // for any file so a scripts/x.py write invalidates the same keys as SKILL.md.
    watcher: {
      eventType: 'skills',
      emitsFor: () => true,
      slugFromRest: (rest) => rest[0],
    },
  },
  // branding.json + uploaded images/ — a tree; per-file overwrite preserves images.
  {
    name: 'branding',
    layout: 'tree',
    readContext: 'node-direct',
    dataModel: 'config',
    scaffoldKind: 'tree',
    // <org>/branding/branding.json — org-level event, no slug.
    watcher: {
      eventType: 'branding',
      emitsFor: JSON_ONLY,
      slugFromRest: () => undefined,
    },
  },
  // The only v8-sync domain: policies are enforced in V8 queries/mutations/
  // auth-hooks. One `<policyType>.json` per policy (kebab filename for the
  // snake_case type), plus the `retention.json` bounds catalog (read separately
  // via the v8-action path) and `*.secrets.json` sidecars.
  {
    name: 'governance',
    layout: 'flat',
    readContext: 'v8-sync',
    dataModel: 'config',
    scaffoldKind: 'flat',
    v8Sync: {
      keys: FILE_POLICY_TYPES,
      schemaFor: (key) => {
        if (!isFilePolicyType(key)) {
          throw new Error(`Unknown governance policy key: ${key}`);
        }
        return POLICY_SCHEMAS[key];
      },
      fileBaseFor: (key) => {
        if (!isFilePolicyType(key)) {
          throw new Error(`Unknown governance policy key: ${key}`);
        }
        return policyTypeToFileBase(key);
      },
    },
  },
];

export const CONFIG_DOMAINS_BY_NAME: ReadonlyMap<string, ConfigDomain> =
  new Map(CONFIG_DOMAINS.map((d) => [d.name, d]));

/**
 * Single-file configs nested inside another domain's dir that still need their
 * own frontend SSE event (read via a V8 action, so not reactive). Today only
 * the retention bounds catalog at `<org>/governance/retention.json`. Kept here
 * (not as a top-level `CONFIG_DOMAINS` entry) because it is scaffolded as part
 * of the `governance` flat domain, not independently.
 */
export const NESTED_SINGLE_FILE_WATCHERS: ReadonlyArray<{
  readonly domain: string;
  readonly file: string;
  readonly eventType: string;
}> = [{ domain: 'governance', file: 'retention.json', eventType: 'retention' }];

/** Domains whose config must be mirrored into `configCache` for V8 reads. */
export const V8_SYNC_DOMAINS: readonly ConfigDomain[] = CONFIG_DOMAINS.filter(
  (d) => d.readContext === 'v8-sync',
);

/** Look up a domain by name, throwing if it is not registered. */
export function getConfigDomain(name: string): ConfigDomain {
  const domain = CONFIG_DOMAINS_BY_NAME.get(name);
  if (!domain) {
    throw new Error(`Unknown config domain: ${name}`);
  }
  return domain;
}

/** The `V8SyncSpec` for a `v8-sync` domain, throwing otherwise. */
export function getV8SyncSpec(name: string): V8SyncSpec {
  const spec = getConfigDomain(name).v8Sync;
  if (!spec) {
    throw new Error(`Config domain "${name}" is not a v8-sync domain`);
  }
  return spec;
}
