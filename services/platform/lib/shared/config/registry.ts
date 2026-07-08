/**
 * Canonical config-domain registry — the single declarative list of file-based
 * config domains the platform loads from `$TALE_CONFIG_DIR/<orgSlug>/<domain>/`.
 * Files are the source of truth; every consumer (the scaffolder, the file
 * watcher, the file→cache sync, the read strategies) keys off this one list.
 *
 * # The two-layer split (Convex V8↔Node bundling boundary)
 *
 * A Convex query/mutation runs in a V8 sandbox that cannot import `node:*`, so a
 * `'use node'` module that touches the filesystem (every `<domain>/file_utils.ts`,
 * `lib/file_io.ts`, `scaffold.ts`) cannot be value-imported by V8 code. The
 * standalone platform `server.ts` (which bundles `config-watcher.ts`) has the
 * same constraint on the Convex client side.
 *
 * So the registry is **Layer A**: pure data + Zod + pure string helpers, with
 * NO `node:*`, NO `convex/_generated`, NO `'use node'`. It is import-safe from
 * V8 Convex code, from `'use node'` actions, and from the platform server.
 * The filesystem path resolvers (`resolve<Domain>Dir`) live in **Layer B**:
 * `convex/lib/config_store/resolvers.ts` (`'use node'`), keyed by `name`.
 */

import type { z } from 'zod/v4';

import {
  ssoConnectionFileSchema,
  SSO_CONFIG_DOMAIN,
  SSO_CONNECTION_KEY,
} from '../schemas/enterprise_sso';
import {
  FILE_POLICY_TYPES,
  isFilePolicyType,
  POLICY_SCHEMAS,
  policyTypeToFileBase,
} from '../schemas/governance';

/**
 * On-disk shape of a domain's catalog/data dir:
 *  - `flat`        — one file per item, no subdirs (providers, prompts, governance).
 *  - `bundle`      — one dir per item (skills, integrations).
 *  - `tree`        — arbitrary nested files (agents, workflows, branding + images/).
 *  - `single-file` — exactly one file for the whole area (retention). Nested in
 *                    a parent domain dir rather than scaffolded on its own.
 */
export type ConfigLayout = 'flat' | 'bundle' | 'tree' | 'single-file';

/**
 * Scaffold/override copy semantics (mirrors the historical `DOMAINS.kind`):
 *  - `flat`   — per-file atomicWrite; user-added files + secrets + `.history/` survive (providers/prompts/governance).
 *  - `bundle` — per-item dir replace (staging + atomic rename); domain-root siblings survive (skills/integrations).
 *  - `tree`   — per-file overwrite recursing into subdirs, no rm; user-only folders survive (agents/workflows/branding).
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
   * scaffolded from the builtin catalog. Absent ⇒ NOT catalog-scaffolded: the
   * files are created on demand by an admin action (e.g. `sso`), so the
   * scaffolder skips the domain rather than failing on a missing catalog dir.
   */
  readonly scaffoldKind?: ScaffoldKind;
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
    // Tree (was flat): agents are organized in folders (chat/,
    // github/) for grouping. Identity is the explicit `slug` field in each
    // config (NOT the path), so files can move between folders without
    // breaking refs; the folder is organizational only.
    layout: 'tree',
    readContext: 'node-direct',
    dataModel: 'config',
    scaffoldKind: 'tree',
    // <org>/agents/[folder/]<name>.json — the SSE hint slug is the path; the
    // frontend refetches the agent list on any agents-domain change anyway.
    watcher: {
      eventType: 'agents',
      emitsFor: JSON_ONLY,
      slugFromRest: (rest) => stripJson(rest.join('/')),
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
  // External token-pool sources: each `<slug>.json` declares a broker endpoint
  // + a response mapping; the rotation engine fetches the pool at run time
  // (node-direct, read in the sandbox action). No cross-domain seed dependency.
  {
    name: 'token-sources',
    layout: 'flat',
    readContext: 'node-direct',
    dataModel: 'config',
    scaffoldKind: 'flat',
    // <org>/token-sources/<slug>.json
    watcher: {
      eventType: 'token-sources',
      emitsFor: JSON_ONLY,
      slugFromRest: (rest) => stripJson(rest[0]),
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
  // A v8-sync domain: policies are enforced in V8 queries/mutations/
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
  // Enterprise SSO connection — a `v8-sync` domain like governance (V8 sign-in
  // hooks/queries read it from `configCache`), but NOT catalog-scaffolded: the
  // single `connection.json` is created on demand by the admin SSO form, so it
  // carries no `scaffoldKind` and ships no builtin default. Its on-disk dir is
  // NESTED under governance (`<org>/governance/sso/`, resolved in Layer B), so
  // its file never collides with the flat governance policy files. Registering
  // it here is exactly what folds SSO into the generic file→cache sync, the
  // cron `reconcileAllConfigCaches`, and org-create/reseed — the same safety
  // nets every other config domain already has (previously the SSO cache was
  // only ever refreshed by a bespoke writer on an admin save).
  {
    name: SSO_CONFIG_DOMAIN, // 'sso'
    layout: 'single-file',
    readContext: 'v8-sync',
    dataModel: 'config',
    v8Sync: {
      keys: [SSO_CONNECTION_KEY], // ['connection']
      schemaFor: () => ssoConnectionFileSchema,
      fileBaseFor: () => SSO_CONNECTION_KEY, // 'connection' (no extension)
    },
  },
  // First-class automations: each `automations/<slug>/` is a bundle (manifest +
  // views/messages/scripts + the app's own app-scoped agents/workflows), copied
  // whole into every org at create. Read directly from disk by the
  // `listAutomations` action (node-direct), so it is NOT mirrored into
  // `configCache`. The DB `automationInstallations` row is the authoritative
  // "installed" signal; the seeded files are the install SOURCE.
  // Order-independent: an app bundles its own agents/workflows, so it has no
  // cross-domain seed dependency. DUAL-READ: an org scaffolded before this
  // domain was renamed from `apps` keeps its bundles at the legacy `apps/` dir
  // (`convex/automations/file_utils.ts` resolves either) — no fs-tree
  // migration needed.
  {
    name: 'automations',
    layout: 'bundle',
    readContext: 'node-direct',
    dataModel: 'runtime-state',
    scaffoldKind: 'bundle',
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
