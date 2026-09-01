'use node';

/**
 * Governance file utilities — per organization.
 *
 * Governance policies live as one file per policy type under the org's own
 * subtree in the uniform org-first layout:
 *   {TALE_CONFIG_DIR}/<orgSlug>/governance/<policy-type>.yml
 * with `.json` still readable as the pre-conversion fallback: org trees are
 * converted `.json`→`.yml` by a versioned node migration, so both formats
 * are valid on disk mid-conversion. Readers resolve through the shared
 * yml-then-json helper (`lib/config_store/read_domain_file.ts`); writers
 * emit `.yml` and supersede the `.json` sibling (see `file_actions.ts`).
 *
 * This is a `flat`-kind domain (one file per item). The retention *bounds
 * catalog* (`retention.yml`/`.json`) and per-policy secrets sidecars
 * (`<name>.secrets.json`, never converted) live alongside the policy files;
 * the Enterprise SSO connection lives in the `sso/` subdir (paths owned by
 * `enterprise_sso/file_utils.ts`).
 *
 * The JSON-suffixed helpers (`resolvePolicyFilePath`, `serializePolicyJson`,
 * `parseRetentionJson`) keep their exact pre-conversion behavior: historical
 * migrations (0.2.85/01, 0.2.87/02+03) import them and must keep producing
 * the era-correct `.json` files when replayed.
 *
 * Pure path + (de)serialization helpers. No Convex dependencies — usable in
 * any Node.js context. Reads/writes themselves live in `file_actions.ts`.
 */

import path from 'node:path';

import { stringifyYaml } from '../../../lib/shared/config/yaml';
import { zodErrorMessage } from '../../../lib/shared/schemas/format-error';
import {
  fileBaseToPolicyType,
  isFilePolicyType,
  POLICY_SCHEMAS,
  policyTypeToFileBase,
  type FilePolicyType,
} from '../../../lib/shared/schemas/governance';
import {
  retentionDefaultsConfigSchema,
  type RetentionDefaultsConfig,
} from '../../../lib/shared/schemas/retention';
import {
  getConfigRoot,
  safeJoinWithinDir,
  sha256,
  validateOrgSlug,
} from '../lib/file_io';

export { sha256 };

const MAX_FILE_SIZE_BYTES = 256 * 1024; // 256 KB
const MAX_HISTORY_ENTRIES = 100;

/** Governance secret sidecar names are slug-like (org-slug / agent-name shape). */
const SECRET_NAME_REGEX = /^[a-z][a-z0-9_-]*$/;

export function validateSecretName(name: string): boolean {
  return SECRET_NAME_REGEX.test(name);
}

// The snake_case↔kebab policy-type mapping lives in the V8-safe
// `lib/shared/schemas/governance.ts` so the config-domain registry can use it
// without importing this `'use node'` module; re-exported here for callers that
// resolve governance file paths.
export { fileBaseToPolicyType, policyTypeToFileBase };

/** Absolute path to an org's governance directory. */
export function resolveGovernanceDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(getConfigRoot('governance'), orgSlug, 'governance');
}

/** On-disk filename base (no extension) for a policy file — kebab-case for
 *  the snake_case policy type, shared by the `.yml` and `.json` resolvers. */
function policyFileBase(policyType: string): string {
  if (!isFilePolicyType(policyType)) {
    throw new Error(`Invalid governance policy type: ${policyType}`);
  }
  return policyTypeToFileBase(policyType);
}

/** Path to a single policy file in the pre-conversion `.json` format —
 *  kept for the historical migrations and the superseded-sibling cleanup;
 *  live writes target {@link resolvePolicyYamlFilePath}. */
export function resolvePolicyFilePath(
  orgSlug: string,
  policyType: string,
): string {
  return safeJoinWithinDir(
    resolveGovernanceDir(orgSlug),
    `${policyFileBase(policyType)}.json`,
  );
}

/** Canonical write target for a policy: `<orgSlug>/governance/<policy-type>.yml`. */
export function resolvePolicyYamlFilePath(
  orgSlug: string,
  policyType: string,
): string {
  return safeJoinWithinDir(
    resolveGovernanceDir(orgSlug),
    `${policyFileBase(policyType)}.yml`,
  );
}

/** Filename base of the retention bounds catalog (`retention.yml`/`.json`). */
export const RETENTION_FILE_BASE = 'retention';

/** Path to the retention bounds catalog in the pre-conversion `.json`
 *  format — kept for the format migration's supersede step; reads go
 *  through the shared yml-then-json helper. */
export function resolveRetentionFilePath(orgSlug: string): string {
  return safeJoinWithinDir(
    resolveGovernanceDir(orgSlug),
    `${RETENTION_FILE_BASE}.json`,
  );
}

/** Canonical path of the converted retention bounds catalog (`retention.yml`). */
export function resolveRetentionYamlFilePath(orgSlug: string): string {
  return safeJoinWithinDir(
    resolveGovernanceDir(orgSlug),
    `${RETENTION_FILE_BASE}.yml`,
  );
}

/**
 * Path to a secrets sidecar: `<orgSlug>/governance/<name>.secrets.json`.
 * Never scaffolded from the catalog and gitignored — the filesystem is the
 * trust boundary for self-hosted secrets (same model as `providers/*.secrets.json`).
 */
export function resolveSecretsFilePath(orgSlug: string, name: string): string {
  if (!validateSecretName(name)) {
    throw new Error(`Invalid governance secret name: ${name}`);
  }
  return safeJoinWithinDir(
    resolveGovernanceDir(orgSlug),
    `${name}.secrets.json`,
  );
}

/**
 * History dir for a policy type. Defence-in-depth: validate the policy type
 * before joining `.history/<policyType>` (mirrors `agents/file_utils.ts`).
 */
export function resolveHistoryDir(orgSlug: string, policyType: string): string {
  if (!isFilePolicyType(policyType)) {
    throw new Error(`Invalid governance policy type: ${policyType}`);
  }
  return safeJoinWithinDir(
    safeJoinWithinDir(resolveGovernanceDir(orgSlug), '.history'),
    policyTypeToFileBase(policyType),
  );
}

/**
 * Parse + validate a policy JSON file against the per-type schema. Returns
 * the schema-normalized config (defaults applied). Throws on invalid input.
 */
export function parsePolicyJson(
  policyType: FilePolicyType,
  content: string,
): unknown {
  const parsed: unknown = JSON.parse(content);
  const result = POLICY_SCHEMAS[policyType].safeParse(parsed);
  if (!result.success) {
    throw new Error(
      zodErrorMessage(`Invalid ${policyType} config`, result.error),
    );
  }
  return result.data;
}

/**
 * Serialize a policy config to the pre-conversion `.json` on-disk form.
 * Unlike the `serializeJson` helper, this preserves empty arrays
 * (`budgets.rules`, `feature_flags.rules`, `chat_filter.categories`, …)
 * which are structurally required by several policy schemas, and applies
 * schema defaults via parse. Live writes serialize via
 * {@link serializePolicyYaml}; this stays for the historical migrations that
 * must keep writing era-correct JSON.
 */
export function serializePolicyJson(
  policyType: FilePolicyType,
  config: unknown,
): string {
  const parsed = POLICY_SCHEMAS[policyType].parse(config);
  return JSON.stringify(parsed, null, 2) + '\n';
}

/**
 * Serialize a policy config to its canonical `.yml` on-disk form: schema
 * defaults applied via parse, then the shared 2-space-indent YAML emitter.
 * Empty arrays survive (YAML `[]`), matching the JSON serializer's contract.
 */
export function serializePolicyYaml(
  policyType: FilePolicyType,
  config: unknown,
): string {
  return stringifyYaml(POLICY_SCHEMAS[policyType].parse(config));
}

/** Parse + validate the retention bounds catalog. Throws on invalid input. */
export function parseRetentionJson(content: string): RetentionDefaultsConfig {
  const parsed: unknown = JSON.parse(content);
  return validateRetentionData(parsed);
}

/** Validate already-parsed retention bounds data (yml-then-json reader). */
export function validateRetentionData(data: unknown): RetentionDefaultsConfig {
  const result = retentionDefaultsConfigSchema.safeParse(data);
  if (!result.success) {
    throw new Error(zodErrorMessage('Invalid retention config', result.error));
  }
  return result.data;
}

/** Serialize the retention bounds catalog to its canonical `.yml` form. */
export function serializeRetentionYaml(
  config: RetentionDefaultsConfig,
): string {
  return stringifyYaml(retentionDefaultsConfigSchema.parse(config));
}

export { MAX_FILE_SIZE_BYTES, MAX_HISTORY_ENTRIES };
