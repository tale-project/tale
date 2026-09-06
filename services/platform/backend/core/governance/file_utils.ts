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
 * emit `.yml` and supersede the `.json` sibling
 * (`lib/governance-policy-write.ts`).
 *
 * This is a `flat`-kind domain (one file per item). The retention *bounds
 * catalog* (`retention.yml`) lives alongside the policy files and is read
 * through the same yml-then-json helper; the Enterprise SSO connection lives
 * in the `sso/` subdir (paths owned by `enterprise_sso/file_utils.ts`).
 * Guardrail secrets are rows in `app.governance_secrets`, never sidecar
 * files.
 *
 * Pure path + serialization helpers, usable in any Node.js context. Reads
 * live in `lib/org-config.ts`, writes in `lib/governance-policy-write.ts`.
 */

import path from 'node:path';

import { stringifyYaml } from '../../../lib/shared/config/yaml';
import {
  isFilePolicyType,
  POLICY_SCHEMAS,
  policyTypeToFileBase,
  type FilePolicyType,
} from '../../../lib/shared/schemas/governance';
import {
  getConfigRoot,
  safeJoinWithinDir,
  validateOrgSlug,
} from '../lib/file_io';

export const MAX_HISTORY_ENTRIES = 100;

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
 *  the superseded sibling a `.yml` write removes; live writes target
 *  {@link resolvePolicyYamlFilePath}. */
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
 * Serialize a policy config to its canonical `.yml` on-disk form: schema
 * defaults applied via parse, then the shared 2-space-indent YAML emitter.
 * Empty arrays survive (YAML `[]`) — several policy schemas require them.
 */
export function serializePolicyYaml(
  policyType: FilePolicyType,
  config: unknown,
): string {
  return stringifyYaml(POLICY_SCHEMAS[policyType].parse(config));
}
