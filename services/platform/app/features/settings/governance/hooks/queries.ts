import { useMemo } from 'react';

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
