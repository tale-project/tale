import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { GOVERNANCE_POLICY_TYPES } from '@/convex/governance/schema';

type PolicyType = (typeof GOVERNANCE_POLICY_TYPES)[number];

export function usePiiConfig(organizationId: string) {
  return useConvexQuery(api.governance.queries.getPolicy, {
    organizationId,
    policyType: 'pii_config' as const,
  });
}

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

export function useMyBudgetStatus(organizationId: string) {
  return useConvexQuery(api.governance.queries.getMyBudgetStatus, {
    organizationId,
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
