import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { Sql, TransactionSql } from 'postgres';

import {
  DEFAULT_PASSWORD_POLICY,
  mergeStrictestPasswordPolicy,
  policyTypeToFileBase,
  type PasswordPolicyConfig,
} from '../../lib/shared/schemas/governance.ts';
import { resolveGovernanceDir } from '../core/governance/file_utils.ts';
import { readGovernancePolicyForOrg, resolveOrgSlug } from './org-config.ts';

/**
 * Cross-org governance-policy resolution. 0.4 merged configCache rows; 0.5
 * merges the same policy files read directly (lib/org-config). `effectiveAt`
 * — the rotation anchor that stops a newly enabled policy from instantly
 * expiring everyone — maps from the configCache row's apply-time to the
 * policy file's mtime (same event: the moment the policy landed on disk).
 */

async function policyFileMtime(
  orgSlug: string,
  policyType: 'password_policy',
): Promise<number | null> {
  const dir = resolveGovernanceDir(orgSlug);
  const fileBase = policyTypeToFileBase(policyType);
  for (const name of [`${fileBase}.yml`, `${fileBase}.json`]) {
    try {
      const info = await stat(path.join(dir, name));
      return Math.floor(info.mtimeMs);
    } catch {
      // Try the next candidate; a missing file simply has no apply-time.
    }
  }
  return null;
}

export async function getStrictestPasswordPolicyForUser(
  sql: Sql | TransactionSql,
  organizationIds: readonly string[],
): Promise<{ policy: PasswordPolicyConfig; effectiveAt: number | null }> {
  if (organizationIds.length === 0) {
    return { policy: DEFAULT_PASSWORD_POLICY, effectiveAt: null };
  }
  const rows = await Promise.all(
    organizationIds.map(async (organizationId) => {
      const policy = await readGovernancePolicyForOrg(
        sql,
        organizationId,
        'password_policy',
      );
      if (!policy) {
        return { policy: DEFAULT_PASSWORD_POLICY, effectiveAt: null };
      }
      const slug = await resolveOrgSlug(sql, organizationId);
      const effectiveAt = slug
        ? await policyFileMtime(slug, 'password_policy')
        : null;
      return { policy, effectiveAt };
    }),
  );
  const policy = mergeStrictestPasswordPolicy(rows.map((r) => r.policy));
  const effectiveAts = rows
    .map((r) => r.effectiveAt)
    .filter((x): x is number => typeof x === 'number');
  return {
    policy,
    effectiveAt: effectiveAts.length === 0 ? null : Math.min(...effectiveAts),
  };
}
