'use node';

/**
 * Governance JSON file utilities — per organization.
 *
 * Governance policies live as one JSON file per policy type under the org's
 * own subtree in the uniform org-first layout:
 *   {TALE_CONFIG_DIR}/<orgSlug>/governance/<policyType>.json
 *
 * This is a `flat`-kind domain (one file per item, like agents/providers).
 * The retention *bounds catalog* (`retention.json`) and per-policy secrets
 * sidecars (`<name>.secrets.json`) live alongside the policy files; SSO
 * provider configs live in the `sso/` subdir.
 *
 * Pure path + (de)serialization helpers. No Convex dependencies — usable in
 * any Node.js context. Reads/writes themselves live in `file_actions.ts`.
 */

import path from 'node:path';

import {
  fileBaseToPolicyType,
  isFilePolicyType,
  POLICY_SCHEMAS,
  policyTypeToFileBase,
  type FilePolicyType,
} from '../../lib/shared/schemas/governance';
import {
  retentionDefaultsConfigSchema,
  type RetentionDefaultsConfig,
} from '../../lib/shared/schemas/retention';
import {
  getConfigRoot,
  safeJoinWithinDir,
  sha256,
  validateOrgSlug,
} from '../lib/file_io';

export { sha256 };

const MAX_FILE_SIZE_BYTES = 256 * 1024; // 256 KB
const MAX_HISTORY_ENTRIES = 100;

/** SSO provider ids are slug-like; same shape as org slugs / agent names. */
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

/** Path to a single policy file: `<orgSlug>/governance/<policy-type>.json`
 *  (kebab-case filename for the snake_case policy type). */
export function resolvePolicyFilePath(
  orgSlug: string,
  policyType: string,
): string {
  if (!isFilePolicyType(policyType)) {
    throw new Error(`Invalid governance policy type: ${policyType}`);
  }
  return safeJoinWithinDir(
    resolveGovernanceDir(orgSlug),
    `${policyTypeToFileBase(policyType)}.json`,
  );
}

/** Path to the retention bounds catalog: `<orgSlug>/governance/retention.json`. */
export function resolveRetentionFilePath(orgSlug: string): string {
  return safeJoinWithinDir(resolveGovernanceDir(orgSlug), 'retention.json');
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

/** Absolute path to an org's SSO provider config directory. */
export function resolveSsoDir(orgSlug: string): string {
  return safeJoinWithinDir(resolveGovernanceDir(orgSlug), 'sso');
}

/** Path to a single SSO provider config: `<orgSlug>/governance/sso/<providerId>.json`. */
export function resolveSsoFilePath(
  orgSlug: string,
  providerId: string,
): string {
  if (!validateSecretName(providerId)) {
    throw new Error(`Invalid SSO provider id: ${providerId}`);
  }
  return safeJoinWithinDir(resolveSsoDir(orgSlug), `${providerId}.json`);
}

/** Path to an SSO provider's secrets sidecar. */
export function resolveSsoSecretsFilePath(
  orgSlug: string,
  providerId: string,
): string {
  if (!validateSecretName(providerId)) {
    throw new Error(`Invalid SSO provider id: ${providerId}`);
  }
  return safeJoinWithinDir(
    resolveSsoDir(orgSlug),
    `${providerId}.secrets.json`,
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
    throw new Error(`Invalid ${policyType} config: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Serialize a policy config to its canonical on-disk form. Unlike the
 * `serializeJson` helper, this preserves empty arrays (`budgets.rules`,
 * `feature_flags.rules`, `chat_filter.categories`, …) which are structurally
 * required by several policy schemas, and applies schema defaults via parse.
 */
export function serializePolicyJson(
  policyType: FilePolicyType,
  config: unknown,
): string {
  const parsed = POLICY_SCHEMAS[policyType].parse(config);
  return JSON.stringify(parsed, null, 2) + '\n';
}

/** Parse + validate the retention bounds catalog. Throws on invalid input. */
export function parseRetentionJson(content: string): RetentionDefaultsConfig {
  const parsed: unknown = JSON.parse(content);
  const result = retentionDefaultsConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid retention config: ${result.error.message}`);
  }
  return result.data;
}

export { MAX_FILE_SIZE_BYTES, MAX_HISTORY_ENTRIES };
