/**
 * Universal JSON-config validation engine — every config domain in
 * `CONFIG_DOMAINS` must declare how its shipped catalog files are validated
 * (`DOMAIN_VALIDATORS` below), and `validateConfigDir` walks a config tree
 * (the builtin catalog OR an org's on-disk tree) validating every file
 * against the domain's shared Zod schema (the SAME schema the platform load
 * path uses — never a hand-rolled twin).
 *
 * Node-flavored (uses `node:fs`), but importable from three call sites that
 * all need the identical validation logic:
 *  - the vitest gate (`builtin_configs_validation.test.ts`) — walks the
 *    builtin catalog PLUS both e2e fixture org trees;
 *  - the build-time CLI gate (`scripts/validate-builtin-configs.ts`) — walks
 *    the builtin catalog before `bun run build` ships an image;
 *  - the runtime `'use node'` action (`convex/lib/config_store/
 *    validate_builtin_catalog.ts`) — walks `$TALE_CONFIG_BUILTIN_DIR` after
 *    deploy, non-fatal.
 *
 * The drift guard: a domain added to the registry with no entry in
 * `DOMAIN_VALIDATORS` fails `checkValidatorRegistryComplete()` with an
 * "add a validator" message, so new domains cannot ship an unvalidated
 * catalog.
 *
 * Unknown-file posture (matches the loaders):
 *  - flat/tree domains — STRICT: the loaders only ever read `*.json`
 *    (+ `*.secrets.json` sidecars), so any other file in the shipped catalog
 *    is a mistake (a typo'd extension would be silently invisible at runtime).
 *  - bundle items (skills/, integrations/<slug>/) — TOLERANT: bundles carry
 *    arbitrary assets (scripts, icons, references) by design.
 *  - bundle roots — dirs only: the loaders enumerate directories.
 *
 * The `automations` domain is intentionally NOT re-validated here: its
 * dedicated gate (`convex/workflow_engine/helpers/validation/builtin_apps.test.ts`)
 * checks far more than schema validity (bindings, label completeness,
 * workflow semantics), and the fixture copies are pinned byte-identical by
 * `convex/automations/fixture_bundle_drift.test.ts`. This module only asserts those
 * gates still exist, so deleting/moving them re-opens the gap loudly.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod/v4';

import { agentJsonSchema } from '../schemas/agents';
import { brandingJsonSchema } from '../schemas/branding';
import {
  ssoConnectionFileSchema,
  ssoConnectionSecretsSchema,
} from '../schemas/enterprise_sso';
import { formatZodErrorFull } from '../schemas/format-error';
import { fileBaseToPolicyType, POLICY_SCHEMAS } from '../schemas/governance';
import { integrationJsonSchema } from '../schemas/integrations';
import { promptJsonSchema } from '../schemas/prompts';
import {
  providerJsonSchema,
  providerSecretsSchema,
} from '../schemas/providers';
import { retentionDefaultsConfigSchema } from '../schemas/retention';
import { parseSkillMd } from '../schemas/skills';
import {
  tokenSourceSchema,
  tokenSourceSecretsSchema,
} from '../schemas/token_sources';
import { workflowJsonSchema } from '../schemas/workflows';
import { CONFIG_DOMAINS } from './registry';

/** This module's own repo-root, used only to check that an externally-gated
 *  domain's covering test file still exists (a repo-relative path check). */
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

// --- shared walk helpers -----------------------------------------------------

/** Placeholder/OS files the scaffolder + loaders never read. */
const IGNORED_BASENAMES = new Set(['.gitkeep', '.DS_Store']);

interface WalkResult {
  /** Files this walker actually validated (schema-parsed or frontmatter-parsed). */
  files: number;
  /** One human-readable line per problem, prefixed with the offending path. */
  issues: string[];
}

const emptyResult = (): WalkResult => ({ files: 0, issues: [] });

const merge = (into: WalkResult, from: WalkResult): void => {
  into.files += from.files;
  into.issues.push(...from.issues);
};

function listDirents(dir: string) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/** JSON.parse with the file path in the error, or undefined on failure. */
function parseJson(abs: string, rel: string, out: WalkResult): unknown {
  try {
    return JSON.parse(readFileSync(abs, 'utf8')) as unknown;
  } catch (err) {
    out.issues.push(
      `${rel}: JSON parse error — ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

/** Parse + schema-validate one JSON file; returns the doc when it validated. */
function checkJsonFile(
  schema: z.ZodType,
  abs: string,
  rel: string,
  out: WalkResult,
): unknown {
  const doc = parseJson(abs, rel, out);
  if (doc === undefined) return undefined;
  out.files += 1;
  const res = schema.safeParse(doc);
  if (!res.success) {
    out.issues.push(`${rel}:\n${formatZodErrorFull(res.error)}`);
    return undefined;
  }
  return doc;
}

// --- per-layout walkers -------------------------------------------------------

interface FlatOptions {
  /** Schema for `<name>.secrets.json` sidecars, when the domain has them. */
  secretsSchema?: z.ZodType;
  /** Exact-filename overrides (e.g. governance's `retention.json`). */
  specialFiles?: Record<string, z.ZodType>;
  /** Named subdirs with their own walker (e.g. governance's nested `sso/`). */
  nestedDirs?: Record<string, (dir: string, relPrefix: string) => WalkResult>;
}

/**
 * Flat layout: one `<name>.json` per item, no subdirs. The loaders read only
 * `*.json` (plus `*.secrets.json` sidecars) — anything else in the shipped
 * catalog would be silently dead weight, so it fails here. Dot-dirs
 * (`.history/`, kept by the flat scaffold semantics) are skipped.
 */
function walkFlat(
  dir: string,
  relPrefix: string,
  schemaFor: (
    fileBase: string,
    rel: string,
    out: WalkResult,
  ) => z.ZodType | undefined,
  opts: FlatOptions = {},
): WalkResult {
  const out = emptyResult();
  for (const entry of listDirents(dir)) {
    const rel = `${relPrefix}${entry.name}`;
    if (entry.isDirectory()) {
      if (opts.nestedDirs?.[entry.name]) {
        merge(
          out,
          opts.nestedDirs[entry.name](join(dir, entry.name), `${rel}/`),
        );
      } else if (!entry.name.startsWith('.')) {
        out.issues.push(
          `${rel}/: unexpected directory in a flat config domain`,
        );
      }
      continue;
    }
    if (IGNORED_BASENAMES.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.name.endsWith('.secrets.json')) {
      if (opts.secretsSchema) {
        checkJsonFile(opts.secretsSchema, abs, rel, out);
      } else {
        out.issues.push(`${rel}: this domain has no secrets sidecar`);
      }
      continue;
    }
    const special = opts.specialFiles?.[entry.name];
    if (special) {
      checkJsonFile(special, abs, rel, out);
      continue;
    }
    if (!entry.name.endsWith('.json')) {
      out.issues.push(
        `${rel}: unexpected non-JSON file (loaders read only *.json)`,
      );
      continue;
    }
    const schema = schemaFor(entry.name.replace(/\.json$/, ''), rel, out);
    if (schema) checkJsonFile(schema, abs, rel, out);
  }
  return out;
}

/**
 * Tree layout: arbitrary nested `*.json` (agents, workflows). The loaders
 * recurse for `*.json` only; any other file in the shipped catalog fails.
 */
function walkJsonTree(
  dir: string,
  relPrefix: string,
  schema: z.ZodType,
  extra?: (doc: unknown, rel: string, out: WalkResult) => void,
): WalkResult {
  const out = emptyResult();
  for (const entry of listDirents(dir)) {
    const rel = `${relPrefix}${entry.name}`;
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.')) {
        merge(
          out,
          walkJsonTree(join(dir, entry.name), `${rel}/`, schema, extra),
        );
      }
      continue;
    }
    if (IGNORED_BASENAMES.has(entry.name)) continue;
    if (!entry.name.endsWith('.json')) {
      out.issues.push(
        `${rel}: unexpected non-JSON file (loaders read only *.json)`,
      );
      continue;
    }
    const doc = checkJsonFile(schema, join(dir, entry.name), rel, out);
    if (doc !== undefined) extra?.(doc, rel, out);
  }
  return out;
}

/**
 * Bundle layout: one dir per item; item contents are free-form assets, but the
 * root holds only item dirs and each item must carry its anchor file.
 */
function walkBundles(
  dir: string,
  relPrefix: string,
  validateItem: (
    itemDir: string,
    slug: string,
    rel: string,
    out: WalkResult,
  ) => void,
): WalkResult {
  const out = emptyResult();
  for (const entry of listDirents(dir)) {
    const rel = `${relPrefix}${entry.name}`;
    if (!entry.isDirectory()) {
      if (!IGNORED_BASENAMES.has(entry.name)) {
        out.issues.push(
          `${rel}: stray file at a bundle-domain root (items are directories)`,
        );
      }
      continue;
    }
    if (entry.name.startsWith('.')) continue;
    validateItem(join(dir, entry.name), entry.name, rel, out);
  }
  return out;
}

// --- per-domain validators ----------------------------------------------------

function validateSsoDir(dir: string, relPrefix: string): WalkResult {
  return walkFlat(
    dir,
    relPrefix,
    (base, rel, out) => {
      out.issues.push(`${rel}: only connection.json lives in the sso domain`);
      return undefined;
    },
    {
      secretsSchema: ssoConnectionSecretsSchema,
      specialFiles: { 'connection.json': ssoConnectionFileSchema },
    },
  );
}

function validateGovernanceDir(dir: string): WalkResult {
  return walkFlat(
    dir,
    '',
    (base, rel, out) => {
      const policyType = fileBaseToPolicyType(base);
      if (!policyType) {
        out.issues.push(
          `${rel}: "${base}" is not a registered governance policy (POLICY_SCHEMAS) — ` +
            'register its schema or remove the file',
        );
        return undefined;
      }
      return POLICY_SCHEMAS[policyType];
    },
    {
      // Secrets sidecars (`<policy>.secrets.json`) are merged into the policy
      // doc by the store before validation, so their standalone shape is only
      // "a JSON object" — parse-checked via a permissive record schema.
      secretsSchema: z.record(z.string(), z.unknown()),
      // The retention bounds catalog is a nested single-file config read via
      // the v8-action path (see NESTED_SINGLE_FILE_WATCHERS), not a policy.
      specialFiles: { 'retention.json': retentionDefaultsConfigSchema },
      // The sso domain's on-disk dir nests under governance/ (see registry).
      nestedDirs: { sso: validateSsoDir },
    },
  );
}

function validateBrandingDir(dir: string): WalkResult {
  const out = emptyResult();
  for (const entry of listDirents(dir)) {
    if (entry.isDirectory()) {
      // Uploaded logo/favicon assets — free-form by design.
      if (entry.name !== 'images' && !entry.name.startsWith('.')) {
        out.issues.push(
          `${entry.name}/: unexpected directory (only images/ is read)`,
        );
      }
      continue;
    }
    if (IGNORED_BASENAMES.has(entry.name)) continue;
    if (entry.name !== 'branding.json') {
      out.issues.push(`${entry.name}: only branding.json + images/ live here`);
      continue;
    }
    checkJsonFile(brandingJsonSchema, join(dir, entry.name), entry.name, out);
  }
  return out;
}

function validateSkillsDir(dir: string): WalkResult {
  return walkBundles(dir, '', (itemDir, slug, rel, out) => {
    const skillMd = join(itemDir, 'SKILL.md');
    if (!existsSync(skillMd)) {
      out.issues.push(`${rel}/: bundle has no SKILL.md`);
      return;
    }
    out.files += 1;
    try {
      parseSkillMd(readFileSync(skillMd, 'utf8'));
    } catch (err) {
      out.issues.push(
        `${rel}/SKILL.md: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
}

function validateIntegrationsDir(dir: string): WalkResult {
  return walkBundles(dir, '', (itemDir, slug, rel, out) => {
    const config = join(itemDir, 'config.json');
    if (!existsSync(config)) {
      out.issues.push(`${rel}/: bundle has no config.json`);
      return;
    }
    checkJsonFile(integrationJsonSchema, config, `${rel}/config.json`, out);
  });
}

type DomainValidator =
  | {
      kind: 'walk';
      validateDir: (dir: string) => WalkResult;
    }
  | {
      kind: 'external-gate';
      /** Repo-relative test files that own this domain's validation. */
      coveredBy: readonly string[];
    };

/**
 * Domain → how its shipped files are validated. Every `CONFIG_DOMAINS` entry
 * MUST appear here — `checkValidatorRegistryComplete` is the drift guard.
 */
const DOMAIN_VALIDATORS: Record<string, DomainValidator> = {
  agents: {
    kind: 'walk',
    validateDir: (dir) => walkJsonTree(dir, '', agentJsonSchema),
  },
  prompts: {
    kind: 'walk',
    validateDir: (dir) => walkFlat(dir, '', () => promptJsonSchema),
  },
  providers: {
    kind: 'walk',
    validateDir: (dir) =>
      walkFlat(dir, '', () => providerJsonSchema, {
        secretsSchema: providerSecretsSchema,
      }),
  },
  integrations: { kind: 'walk', validateDir: validateIntegrationsDir },
  'token-sources': {
    kind: 'walk',
    validateDir: (dir) =>
      walkFlat(dir, '', () => tokenSourceSchema, {
        secretsSchema: tokenSourceSecretsSchema,
      }),
  },
  // Schema-only, matching the load path: the file catalog is parsed with
  // `workflowJsonSchema` (`convex/workflows/file_utils.ts`) and is never
  // publish-gated — `validateWorkflowDefinition` runs only on the agent-tool
  // create/save (publish) path, and several shipped builtins predate its
  // stricter reference/port lints while running fine. App-BUNDLED workflows
  // DO pass full definition validation in the builtin_apps gate.
  workflows: {
    kind: 'walk',
    validateDir: (dir) => walkJsonTree(dir, '', workflowJsonSchema),
  },
  skills: { kind: 'walk', validateDir: validateSkillsDir },
  branding: { kind: 'walk', validateDir: validateBrandingDir },
  governance: { kind: 'walk', validateDir: validateGovernanceDir },
  sso: { kind: 'walk', validateDir: (dir) => validateSsoDir(dir, '') },
  automations: {
    kind: 'external-gate',
    coveredBy: [
      'services/platform/convex/workflow_engine/helpers/validation/builtin_apps.test.ts',
      'services/platform/convex/automations/fixture_bundle_drift.test.ts',
    ],
  },
};

/**
 * The schema for a single `.json` catalog file within a domain, keyed by its
 * OWN filename (basename only — every domain here either applies one schema
 * to every file regardless of its folder, or keys on the exact filename, so
 * the containing path never matters). Used by the scaffolder
 * (`organizations/scaffold.ts`) to validate one file at a time during a
 * catalog→org copy, so a single corrupt catalog file can be skipped without
 * aborting the whole domain.
 *
 * Returns `undefined` when this domain has no single reusable schema for the
 * given filename (a bundle item's non-anchor asset, `skills/*\/SKILL.md`
 * which isn't JSON, or the `automations` domain's manifest+views structure, which
 * has no one schema) — the caller then copies the file unchecked. This is a
 * narrower, "catch the common case" guard; `validateConfigDir` above is the
 * exhaustive one (CI + build-time).
 */
export function domainCatalogFileSchema(
  domainName: string,
  fileName: string,
): z.ZodType | undefined {
  switch (domainName) {
    case 'agents':
      return agentJsonSchema;
    case 'prompts':
      return promptJsonSchema;
    case 'providers':
      return fileName.endsWith('.secrets.json')
        ? providerSecretsSchema
        : providerJsonSchema;
    case 'token-sources':
      return fileName.endsWith('.secrets.json')
        ? tokenSourceSecretsSchema
        : tokenSourceSchema;
    case 'workflows':
      return workflowJsonSchema;
    case 'branding':
      return fileName === 'branding.json' ? brandingJsonSchema : undefined;
    case 'integrations':
      return fileName === 'config.json' ? integrationJsonSchema : undefined;
    case 'governance': {
      if (fileName === 'retention.json') return retentionDefaultsConfigSchema;
      // Secrets sidecars are merged into the policy doc before validation
      // elsewhere — not worth gating a scaffold copy on their standalone shape.
      if (fileName.endsWith('.secrets.json')) return undefined;
      const policyType = fileBaseToPolicyType(fileName.replace(/\.json$/, ''));
      return policyType ? POLICY_SCHEMAS[policyType] : undefined;
    }
    default:
      // skills (SKILL.md isn't JSON), sso (not catalog-scaffolded), automations
      // (external-gate — no single schema) — not validated here.
      return undefined;
  }
}

// --- public API ----------------------------------------------------------------

interface ConfigDirValidation {
  /** One human-readable line per problem found under `rootDir`. Empty = clean. */
  issues: string[];
  /** Total files schema-validated across every domain under `rootDir`. */
  filesValidated: number;
}

/**
 * Walk every `CONFIG_DOMAINS` domain with a `'walk'` validator under
 * `rootDir` and validate its shipped files against the domain's shared Zod
 * schema. `kind` controls two root-shape assumptions:
 *  - `'catalog'` — the builtin catalog: every catalog-scaffolded domain
 *    (`scaffoldKind` set) MUST have a dir here with at least one valid file;
 *    a missing dir or a zero-file domain is an issue.
 *  - `'org'` — an org's (or a fixture org's) on-disk tree: partial by design,
 *    so a missing domain dir is fine.
 *
 * The `automations` domain (an `'external-gate'` validator) is never walked here —
 * see the module doc for why.
 */
export function validateConfigDir(
  rootDir: string,
  kind: 'catalog' | 'org',
): ConfigDirValidation {
  const issues: string[] = [];
  let filesValidated = 0;

  for (const domain of CONFIG_DOMAINS) {
    const validator = DOMAIN_VALIDATORS[domain.name];
    if (validator?.kind !== 'walk') continue;

    const domainDir = join(rootDir, domain.name);
    if (!existsSync(domainDir)) {
      // The builtin catalog must ship every catalog-scaffolded domain; org
      // trees are partial by design (a fixture org ships only what its specs
      // need), so absent domain dirs are fine there; non-scaffolded domains
      // (sso) ship no builtin default either.
      if (!(kind === 'org' || domain.scaffoldKind === undefined)) {
        issues.push(
          `builtin catalog is missing the "${domain.name}" domain dir`,
        );
      }
      continue;
    }

    const result = validator.validateDir(domainDir);
    issues.push(...result.issues);
    filesValidated += result.files;

    if (
      kind === 'catalog' &&
      domain.scaffoldKind !== undefined &&
      result.files === 0
    ) {
      issues.push(
        `the builtin "${domain.name}" catalog validated zero files — the ` +
          'walker or the catalog moved',
      );
    }
  }

  return { issues, filesValidated };
}

interface RegistryCheckOptions {
  /**
   * Also verify that every externally-gated domain's covering test files
   * still exist on disk. This half of the check is checkout-bound — test
   * files live only in a repo checkout and are never bundled into a shipped
   * image — so the runtime action turns it off (#2675: with it on, every
   * healthy container boot reported the `automations` gates as "gone"). The
   * vitest gate and the build-time CLI gate keep the default (on), which is
   * what still catches a covering test being deleted or moved without
   * updating `DOMAIN_VALIDATORS`.
   */
  checkCoveringGates?: boolean;
  /** Root the covering-gate paths resolve against — injectable for tests. */
  repoRoot?: string;
}

/**
 * The registry drift guard: every `CONFIG_DOMAINS` entry must declare a
 * validator, every validator must map back to a registered domain, and (in
 * checkout contexts — see `RegistryCheckOptions`) every externally-gated
 * domain's covering test files must still exist. Returns one human-readable
 * issue per problem; empty = the registry is complete.
 */
export function checkValidatorRegistryComplete(
  options: RegistryCheckOptions = {},
): string[] {
  const { checkCoveringGates = true, repoRoot = REPO_ROOT } = options;
  const issues: string[] = [];

  for (const domain of CONFIG_DOMAINS) {
    if (!DOMAIN_VALIDATORS[domain.name]) {
      issues.push(
        `Config domain "${domain.name}" is registered in CONFIG_DOMAINS but ` +
          'has no entry in DOMAIN_VALIDATORS — add a validator for its ' +
          'builtin JSONs to lib/shared/config/catalog_validator.ts',
      );
    }
  }

  const registered = new Set(CONFIG_DOMAINS.map((d) => d.name));
  for (const name of Object.keys(DOMAIN_VALIDATORS)) {
    if (!registered.has(name)) {
      issues.push(
        `"${name}" has a DOMAIN_VALIDATORS entry but is not registered in CONFIG_DOMAINS`,
      );
    }
  }

  if (checkCoveringGates) {
    for (const [name, validator] of Object.entries(DOMAIN_VALIDATORS)) {
      if (validator.kind !== 'external-gate') continue;
      for (const rel of validator.coveredBy) {
        if (!existsSync(join(repoRoot, rel))) {
          issues.push(
            `${name}: covering gate ${rel} is gone — restore it or fold the ` +
              'domain into this suite',
          );
        }
      }
    }
  }

  return issues;
}
