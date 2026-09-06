/**
 * Config-domain registry — pure data, importable from anywhere (the
 * backend, Bun scripts, vitest, the browser). NO `node:*`: a domain's
 * on-disk directory is resolved in `backend/core/lib/config_store/
 * resolvers.ts`, the one place that value-imports the per-domain
 * `file_utils` modules.
 *
 * Per-org configuration is a file tree, never a database row:
 * `$TALE_CONFIG_DIR/<orgSlug>/<domain>/…`. This module declares WHAT the
 * domains are — the dir name, how the org scaffolder seeds a domain from
 * the builtin catalog (`configs/platform/custom/<domain>/`), and which
 * seeded files carry a Zod schema the copy validates against. The default
 * on-disk format is YAML-first with a `.json` fallback per file; `skills` is
 * the one domain whose files are markdown with YAML frontmatter, because a
 * skill is a document.
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
type ScaffoldKind = 'flat' | 'bundle' | 'tree';

/**
 * The catalog files the scaffolder validates before copying them into an
 * org's tree: `fileBaseFor(key)` names the file (no extension) under the
 * domain dir, `schemaFor(key)` the schema its contents must satisfy. A
 * catalog file no key maps to copies unchecked.
 */
interface SeedSchemaSpec {
  /** Stable keys for this domain's schema-checked files. */
  readonly keys: readonly string[];
  /** key → Zod schema, validated before the file is seeded. */
  schemaFor: (key: string) => z.ZodType;
  /** key → on-disk filename base (no extension), relative to the domain dir. */
  fileBaseFor: (key: string) => string;
}

export interface ConfigDomain {
  /** Catalog dir name AND on-disk domain dir: `<orgSlug>/<name>/`. */
  readonly name: string;
  /**
   * Present iff this domain is independently scaffolded from the builtin
   * catalog. Absent ⇒ created on demand by an admin action (e.g. `sso`), so
   * the scaffolder skips it instead of failing on a missing catalog dir.
   */
  readonly scaffoldKind?: ScaffoldKind;
  /** Present iff some of the domain's files are schema-checked when seeded. */
  readonly seedSchemas?: SeedSchemaSpec;
}

/**
 * The canonical domain list. Order matters: org scaffolding seeds domains in
 * this order — keep it stable.
 */
export const CONFIG_DOMAINS: readonly ConfigDomain[] = [
  // Governance policies — one `<policy-type>.yml` per policy (kebab filename
  // for the snake_case type; `.json` readable pre-conversion) plus
  // `*.secrets.json` sidecars. Every seeded policy file is validated against
  // its policy schema before it is copied.
  {
    name: 'governance',
    scaffoldKind: 'flat',
    seedSchemas: {
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
  // Enterprise SSO connection — NOT catalog-scaffolded: the single
  // `connection.yml` is created on demand by the admin SSO form. Its on-disk
  // dir is nested under governance (`<org>/governance/sso/`, see
  // resolvers.ts) so it never collides with the flat policy files.
  {
    name: SSO_CONFIG_DOMAIN,
    seedSchemas: {
      keys: [SSO_CONNECTION_KEY],
      schemaFor: () => ssoConnectionFileSchema,
      fileBaseFor: () => SSO_CONNECTION_KEY,
    },
  },
  // Custom AI-provider connectors — one `<name>.yml` per org-defined
  // connector (a vLLM/Ollama box, an internal gateway), read by the
  // provider-resolution modules (`backend/core/lib/providers/
  // org_providers.ts`) wherever provider resolution runs. Not
  // catalog-scaffolded: there is no builtin seed — the domain dir is created
  // on demand when an org authors its first custom connector. Credentials
  // for custom connectors live in the same `providerCredentials` table as
  // the shipped ones.
  {
    name: 'providers',
  },
  // Skills — one bundle directory per skill (`<org>/skills/<slug>/SKILL.md`
  // plus small assets). A skill is a knowledge pack an agent expands, never
  // something the platform runs, so the files are read at the two places
  // that consume them: staging a sandbox workspace and answering the skill
  // tools during a turn. Sharing lives in the file itself — `visibility:
  // private | org` with an `owner` — so there is nothing to mirror into a
  // table and no cross-org surface to scope. Catalog-scaffolded (`bundle`: a
  // whole `<slug>/` directory tree per skill) so a fresh org ships with the
  // builtin skills under `configs/platform/custom/skills/` — e.g. the baked
  // `visual-aspect-analyzer`. An org still authors or imports its own skills
  // alongside them; the org-facing editor reads and writes the same files.
  {
    name: 'skills',
    scaffoldKind: 'bundle',
  },
  // Agents — one `<org>/agents/<slug>.yml` per agent. An agent is a persona:
  // a name, instructions, what it may reach for, and who may use it. It says
  // nothing about how a turn executes (no model, no ceiling, no harness, no
  // credentials), so there is no runtime state to keep beside the file and
  // nothing to mirror into a table. Read at the two places that consume it
  // — the org-facing editor and the turn that resolves the agent answering.
  // Sharing lives in the file (`visibility: private | org` with an `owner`),
  // which is also why nothing here is shared across organizations: a file
  // only exists inside one org's tree. Catalog-scaffolded (`flat`: one
  // `<slug>.yml` per agent) so a fresh org ships with the builtin agents
  // under `configs/platform/custom/agents/` — e.g. the Coding Agent, which
  // lists the baked `visual-aspect-analyzer` skill in its `skills:`
  // allowlist.
  {
    name: 'agents',
    scaffoldKind: 'flat',
  },
];
