import { useMemo } from 'react';

import { useActionQuery } from '@/app/hooks/use-action-query';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { GOVERNANCE_POLICY_TYPES } from '@/convex/governance/schema';
import type { SoftDeleteResourceType } from '@/convex/governance/soft_delete_validators';
import {
  CHAT_MAX_FILE_SIZE,
  CHAT_UPLOAD_ALLOWED_TYPES,
  DOCUMENT_MAX_FILE_SIZE,
} from '@/lib/shared/file-types';
import {
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicyConfig,
  passwordPolicyConfigSchema,
  uploadPolicyConfigSchema,
  type UploadPolicyConfig,
} from '@/lib/shared/schemas/governance';
import { isRecord } from '@/lib/utils/type-guards';

type PolicyType = (typeof GOVERNANCE_POLICY_TYPES)[number];

interface UploadPolicyLimits {
  maxFileSize: number;
  allowedTypes: string[];
  allowedExtensions: string[];
  blockedExtensions: string[];
  documentMaxFileSize: number;
  policyEnabled: boolean;
}

function parseUploadPolicyConfig(
  rawConfig: unknown,
): UploadPolicyConfig | null {
  const config = isRecord(rawConfig) ? rawConfig : {};
  const result = uploadPolicyConfigSchema.safeParse(config);
  if (result.success) {
    return result.data;
  }
  return null;
}

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

/**
 * Banner feed for the operator-side bounds proposal gate.
 *
 * One-shot fetch (TanStack Query, no Convex reactivity) — bounds change
 * rarely and the banner only needs to refetch on mount + after the
 * admin clicks Apply/Reject (mutation hooks invalidate this key).
 *
 * Returns `null` when nothing is pending: applied bounds match the
 * operator's current effective bounds, OR the admin already rejected
 * the current hash and the operator hasn't edited since.
 */
export function usePendingBoundsProposal(organizationId: string) {
  return useActionQuery(
    ['retention-bounds-proposal', organizationId],
    api.governance.retention_bounds_proposal.getPendingBoundsProposal,
    { organizationId },
  );
}

type LegalHoldTargetType =
  | 'thread'
  | 'document'
  | 'execution'
  | 'userMembership'
  | 'org';

type LegalHoldStatus = 'active' | 'released' | 'all';

type LegalReleaseStatus = 'pending' | 'approved' | 'rejected' | 'effected';

type LegalMatterStatus = 'open' | 'closed' | 'all';

export function useLegalHolds(
  organizationId: string | undefined,
  options?: { status?: LegalHoldStatus; targetType?: LegalHoldTargetType },
) {
  return useConvexQuery(
    api.governance.legal_hold_queries.listLegalHolds,
    organizationId
      ? {
          organizationId,
          status: options?.status,
          targetType: options?.targetType,
        }
      : 'skip',
  );
}

export function useLegalMatters(
  organizationId: string | undefined,
  options?: { status?: LegalMatterStatus },
) {
  return useConvexQuery(
    api.governance.legal_hold_queries.listLegalMatters,
    organizationId ? { organizationId, status: options?.status } : 'skip',
  );
}

export function useLegalHoldReleaseRequests(
  organizationId: string | undefined,
  status: LegalReleaseStatus,
) {
  return useConvexQuery(
    api.governance.legal_hold_queries.listLegalHoldReleaseRequests,
    organizationId ? { organizationId, status } : 'skip',
  );
}

export function useLegalHoldReleaseRequestsPaginated(args: {
  organizationId: string | undefined;
  status: LegalReleaseStatus;
  initialNumItems?: number;
}) {
  return useCachedPaginatedQuery(
    api.governance.legal_hold_queries.listLegalHoldReleaseRequestsPaginated,
    args.organizationId
      ? { organizationId: args.organizationId, status: args.status }
      : 'skip',
    { initialNumItems: args.initialNumItems ?? 25 },
  );
}

export function useLegalHoldByTarget(args: {
  organizationId: string | undefined;
  targetType: LegalHoldTargetType;
  targetId: string | undefined;
}) {
  return useConvexQuery(
    api.governance.legal_hold_queries.getLegalHoldByTarget,
    args.organizationId && args.targetId
      ? {
          organizationId: args.organizationId,
          targetType: args.targetType,
          targetId: args.targetId,
        }
      : 'skip',
  );
}

export function useActiveHoldTargetIds(args: {
  organizationId: string | undefined;
  targetType: LegalHoldTargetType;
}) {
  return useConvexQuery(
    api.governance.legal_hold_queries.listActiveHoldTargetIds,
    args.organizationId
      ? { organizationId: args.organizationId, targetType: args.targetType }
      : 'skip',
  );
}

export function useOrgMembersForPicker(organizationId: string | undefined) {
  return useConvexQuery(
    api.governance.legal_hold_queries.listOrgMembersForPicker,
    organizationId ? { organizationId } : 'skip',
  );
}

export function useUploadPolicy(organizationId: string): UploadPolicyLimits {
  const { data: policy } = useGovernancePolicy(organizationId, 'upload_policy');

  return useMemo(() => {
    const config = policy ? parseUploadPolicyConfig(policy.config) : null;

    if (!config || !config.enabled) {
      return {
        maxFileSize: CHAT_MAX_FILE_SIZE,
        allowedTypes: [...CHAT_UPLOAD_ALLOWED_TYPES],
        allowedExtensions: [],
        blockedExtensions: [],
        documentMaxFileSize: DOCUMENT_MAX_FILE_SIZE,
        policyEnabled: false,
      };
    }

    return {
      maxFileSize: config.maxFileSizeBytes ?? CHAT_MAX_FILE_SIZE,
      allowedTypes:
        config.allowedMimeTypes && config.allowedMimeTypes.length > 0
          ? config.allowedMimeTypes
          : [...CHAT_UPLOAD_ALLOWED_TYPES],
      allowedExtensions: (config.allowedExtensions ?? []).map((e) =>
        e.toLowerCase().replace(/^\./, ''),
      ),
      blockedExtensions: (config.blockedExtensions ?? []).map((e) =>
        e.toLowerCase().replace(/^\./, ''),
      ),
      documentMaxFileSize: config.maxFileSizeBytes ?? DOCUMENT_MAX_FILE_SIZE,
      policyEnabled: true,
    };
  }, [policy]);
}

export function useListTrashedRows(
  organizationId: string,
  args: {
    resourceTypes?: SoftDeleteResourceType[];
    cursor?: { ts: number; id: string } | null;
    limit?: number;
  },
  enabled: boolean,
) {
  return useConvexQuery(
    api.governance.queries.listTrashedRows,
    enabled
      ? {
          organizationId,
          resourceTypes: args.resourceTypes,
          cursor: args.cursor ?? null,
          limit: args.limit,
        }
      : 'skip',
  );
}
