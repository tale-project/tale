import { useMemo } from 'react';

import { useActionQuery } from '@/app/hooks/use-action-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { GOVERNANCE_POLICY_TYPES } from '@/convex/governance/schema';
import {
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicyConfig,
  passwordPolicyConfigSchema,
} from '@/lib/shared/schemas/governance';

type PolicyType = (typeof GOVERNANCE_POLICY_TYPES)[number];

export function useGovernancePolicy(
  organizationId: string,
  policyType: PolicyType,
) {
  return useConvexQuery(api.governance.queries.getPolicy, {
    organizationId,
    policyType,
  });
}

export function useMyFeatureFlags(organizationId: string) {
  return useConvexQuery(api.governance.queries.getMyFeatureFlags, {
    organizationId,
  });
}

export function useMyBudgetStatus(
  organizationId: string,
  selectedTeamId?: string | null,
) {
  return useConvexQuery(api.governance.queries.getMyBudgetStatus, {
    organizationId,
    selectedTeamId: selectedTeamId ?? null,
  });
}

export function useAccessibleModels(
  organizationId: string,
  modelIds: string[],
) {
  return useConvexQuery(
    api.governance.queries.getAccessibleModelsForUser,
    modelIds.length > 0 ? { organizationId, modelIds } : 'skip',
  );
}

/**
 * Resolved password policy for the given organization. Returns the
 * built-in defaults while the query is loading, when no organizationId
 * is available, or when the stored config is invalid. Reactive: Convex
 * subscriptions auto-update when admins save a new policy.
 */
export function usePasswordPolicy(
  organizationId: string | undefined,
): PasswordPolicyConfig {
  const result = useConvexQuery(
    api.governance.queries.getPolicy,
    organizationId
      ? { organizationId, policyType: 'password_policy' as const }
      : 'skip',
  );

  return useMemo(() => {
    const row = result.data;
    if (!row || typeof row !== 'object' || !('config' in row)) {
      return DEFAULT_PASSWORD_POLICY;
    }
    const parsed = passwordPolicyConfigSchema.safeParse(row.config);
    return parsed.success ? parsed.data : DEFAULT_PASSWORD_POLICY;
  }, [result.data]);
}

/**
 * Masked status of the org's moderation auth header. Returns a masked
 * string like "Bearer••••••xyz" when configured, the sentinel
 * "•••• (key rotated — re-save)" when ciphertext exists but can't be
 * decrypted with the current `GUARDRAILS_SECRET_KEY`, or `null` when
 * nothing is stored.
 */
export function useModerationSecretStatus(organizationId: string) {
  return useActionQuery(
    ['moderation-secret-status', organizationId],
    api.governance.moderation_provider.secrets.hasModerationSecret,
    { organizationId },
  );
}
