/**
 * Config-domain registry — Layer A (pure data, V8-safe).
 *
 * A Convex query/mutation runs in a V8 sandbox that cannot import `node:*`,
 * so anything filesystem-flavored lives in Layer B
 * (`convex/lib/config_store/resolvers.ts` + the per-domain `file_utils.ts`
 * modules, all `'use node'`). This module declares WHAT the config domains
 * are as pure data — Zod schemas, key lists, copy semantics — and may be
 * imported from anywhere: V8 Convex code, node actions, Bun scripts, vitest,
 * and the browser. NO `node:*`, NO `convex/_generated`, NO `'use node'`.
 *
 * This is the seed of the config-system rewrite registry. The rebuilt
 * AI-backend domains (agents, automations, integrations, …) re-register here
 * as their phases land. The default on-disk format is YAML-first with a
 * `.json` fallback per file (the shared reader in
 * `convex/lib/config_store/read_domain_file.ts`): a versioned node migration
 * converts org trees in place, and both formats read correctly while any
 * tree is still unconverted. `skills` is the one domain whose files are
 * markdown with YAML frontmatter, because a skill is a document.
 */

import type { z } from 'zod/v4';

import {
  SSO_CONFIG_DOMAIN,
  SSO_CONNECTION_KEY,
} from '../schemas/enterprise_sso';
import { ssoConnectionFileSchema } from '../schemas/enterprise_sso';
import {
  FILE_POLICY_TYPES,
  isFilePolicyType,
  POLICY_SCHEMAS,
  policyTypeToFileBase,
} from '../schemas/governance';

/**
 * Scaffold copy semantics for domains seeded from the builtin catalog:
 *  - `flat`   — per-file atomic write; user-added files + `.secrets` sidecars
 *               + `.history/` survive a reseed.
 *  - `bundle` — per-item directory replace (staging dir + atomic rename);
 *               domain-root siblings survive.
 *  - `tree`   — per-file overwrite recursing into subdirectories, never `rm`;
 *               user-only folders survive.
 */
export type ScaffoldKind = 'flat' | 'bundle' | 'tree';

/**
 * How a domain's config is READ at runtime — the crux of the architecture:
 *  - `node-direct` — read from the filesystem inside a `'use node'` action.
 *  - `v8-action`   — a V8 action delegates to a `'use node'` action via
 *                    `ctx.runAction`.
 *  - `v8-sync`     — read from V8 queries/mutations/auth-hooks (which cannot
 *                    touch the filesystem), so files are mirrored into the
 *                    derived `configCache` table and read from there.
 */
export type ReadContext = 'node-direct' | 'v8-action' | 'v8-sync';

/**
 * Where the AUTHORITATIVE copy lives:
 *  - `config`        — the file is the source of truth; the DB only ever holds
 *                      a re-derivable cache (`configCache`).
 *  - `runtime-state` — the file holds the definition; the DB holds only
 *                      per-org runtime state (install rows, trigger rows).
 * (The pre-rewrite `seeded-user-data` model — the prompt library — is
 * retired; no v2 domain may reintroduce a DB-authoritative config.)
 */
export type ConfigDataModel = 'config' | 'runtime-state';

/**
 * Drives the generic file→`configCache` mirror for `v8-sync` domains. Pure
 * (no fs): the `'use node'` sync action joins `fileBaseFor(key)` onto the
 * domain dir (resolved via Layer B) to locate each file.
 */
export interface V8SyncSpec {
  /** Stable cache keys for this domain (the `key` column of `configCache`). */
  readonly keys: readonly string[];
  /** key → Zod schema, validated before mirroring AND on read. */
  schemaFor: (key: string) => z.ZodType;
  /** key → on-disk filename base (no extension), relative to the domain dir. */
  fileBaseFor: (key: string) => string;
}

/**
 * Drives the dev file-watcher → frontend SSE cache invalidation for domains
 * read via Convex ACTIONS (not reactive, so a file edit needs an explicit
 * signal). `v8-sync` domains don't need one — their readers are reactive
 * queries on `configCache`.
 */
export interface DomainWatcherSpec {
  /** SSE event `type` emitted to the frontend for a change in this domain. */
  readonly eventType: string;
  /** Emit only when the changed path (relative to the domain dir) matches. */
  emitsFor: (relPathWithinDomain: string) => boolean;
  /** Derive the change `slug` from the path segments below the domain dir. */
  slugFromRest: (rest: readonly string[]) => string | undefined;
}

export interface ConfigDomain {
  /** Catalog dir name AND on-disk domain dir: `<orgSlug>/<name>/`. */
  readonly name: string;
  readonly readContext: ReadContext;
  readonly dataModel: ConfigDataModel;
  /**
   * Present iff this domain is independently scaffolded from the builtin
   * catalog. Absent ⇒ created on demand by an admin action (e.g. `sso`), so
   * the scaffolder skips it instead of failing on a missing catalog dir.
   */
  readonly scaffoldKind?: ScaffoldKind;
  /** Present iff `readContext === 'v8-sync'`. */
  readonly v8Sync?: V8SyncSpec;
  /** Present iff dev edits to this domain need a frontend SSE invalidation. */
  readonly watcher?: DomainWatcherSpec;
}

/**
 * The canonical domain list. Order matters: org scaffolding seeds domains in
 * this order — keep it stable when phase-1+ re-registers the rebuilt domains.
 */
export const CONFIG_DOMAINS: readonly ConfigDomain[] = [
  // Governance policies — enforced from V8 queries/mutations/auth-hooks, so
  // mirrored into `configCache`. One `<policy-type>.yml` per policy (kebab
  // filename for the snake_case type; `.json` readable pre-conversion) plus
  // `*.secrets.json` sidecars.
  {
    name: 'governance',
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
  // Enterprise SSO connection — v8-sync like governance (sign-in hooks read
  // the `configCache` mirror) but NOT catalog-scaffolded: the single
  // `connection.yml` is created on demand by the admin SSO form. Its on-disk
  // dir is nested under governance (`<org>/governance/sso/`, resolved in
  // Layer B) so it never collides with the flat policy files.
  {
    name: SSO_CONFIG_DOMAIN,
    readContext: 'v8-sync',
    dataModel: 'config',
    v8Sync: {
      keys: [SSO_CONNECTION_KEY],
      schemaFor: () => ssoConnectionFileSchema,
      fileBaseFor: () => SSO_CONNECTION_KEY,
    },
  },
  // Custom AI-provider connectors — one `<name>.yml` per org-defined
  // connector (a vLLM/Ollama box, an internal gateway), read directly from
  // `'use node'` actions (`convex/lib/providers/org_connectors.ts`) wherever
  // provider resolution runs. Not catalog-scaffolded: there is no builtin
  // seed — the domain dir is created on demand when an org authors its first
  // custom connector. Credentials for custom connectors live in the same
  // `providerCredentials` table as the shipped ones.
  {
    name: 'providers',
    readContext: 'node-direct',
    dataModel: 'config',
  },
  // Skills — one bundle directory per skill (`<org>/skills/<slug>/SKILL.md`
  // plus small assets). A skill is a knowledge pack an agent expands, never
  // something the platform runs, so the files are read from `'use node'` code
  // at the two places that consume them: staging a sandbox workspace and
  // answering the skill tools during a turn. Sharing lives in the file itself
  // — `visibility: private | org` with an `owner` — so there is nothing to
  // mirror into a table and no cross-org surface to scope. Catalog-scaffolded
  // (`bundle`: a whole `<slug>/` directory tree per skill) so a fresh org ships
  // with the builtin skills under `configs/platform/custom/skills/` — e.g. the
  // baked `visual-aspect-analyzer`. An org still authors or imports its own
  // skills alongside them. The org-facing editing surface is a V8 action
  // delegating to the same node layer (`convex/skills/`).
  {
    name: 'skills',
    readContext: 'node-direct',
    dataModel: 'config',
    scaffoldKind: 'bundle',
  },
  // Agents — one `<org>/agents/<slug>.yml` per agent. An agent is a persona:
  // a name, instructions, what it may reach for, and who may use it. It says
  // nothing about how a turn executes (no model, no ceiling, no harness, no
  // credentials), so there is no runtime state to keep beside the file and
  // nothing to mirror into a table. Read from `'use node'` code at the two
  // places that consume it — the org-facing editor and the turn that resolves
  // the agent answering — so `node-direct` like skills and providers. Sharing
  // lives in the file (`visibility: private | org` with an `owner`), which is
  // also why nothing here is shared across organizations: a file only exists
  // inside one org's tree. Catalog-scaffolded (`flat`: one `<slug>.yml` per
  // agent) so a fresh org ships with the builtin agents under
  // `configs/platform/custom/agents/` — e.g. the Coding Agent, which lists the
  // baked `visual-aspect-analyzer` skill in its `skills:` allowlist.
  {
    name: 'agents',
    readContext: 'node-direct',
    dataModel: 'config',
    scaffoldKind: 'flat',
  },
];

const CONFIG_DOMAINS_BY_NAME: ReadonlyMap<string, ConfigDomain> = new Map(
  CONFIG_DOMAINS.map((domain) => [domain.name, domain]),
);

/** Domains whose config must be mirrored into `configCache` for V8 reads. */
export const V8_SYNC_DOMAINS: readonly ConfigDomain[] = CONFIG_DOMAINS.filter(
  (domain) => domain.readContext === 'v8-sync',
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
