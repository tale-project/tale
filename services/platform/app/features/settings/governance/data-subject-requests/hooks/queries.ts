import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { ErasureStatus } from '@/convex/governance/erasure_constants';

export function useListErasureRequests(args: {
  organizationId: string | undefined;
  statuses?: ErasureStatus[];
  initialNumItems?: number;
}) {
  return useCachedPaginatedQuery(
    api.governance.erasure_queries.listErasureRequests,
    args.organizationId
      ? {
          organizationId: args.organizationId,
          statuses:
            args.statuses && args.statuses.length > 0
              ? args.statuses
              : undefined,
        }
      : 'skip',
    { initialNumItems: args.initialNumItems ?? 25 },
  );
}

export function useGetErasureRequest(
  requestId: Id<'gdprErasureRequests'> | undefined,
) {
  return useConvexQuery(
    api.governance.erasure_queries.getErasureRequest,
    requestId ? { requestId } : 'skip',
  );
}

/**
 * Reuse the legal-hold member picker query — it already returns the
 * shape the searchable-select needs (`userId`, `email`, `displayName`,
 * `role`) and is admin-gated. Kept under this feature's hooks so future
 * picker swaps live in one place.
 */
export function useOrgMembersForErasurePicker(
  organizationId: string | undefined,
) {
  return useConvexQuery(
    api.governance.legal_hold_queries.listOrgMembersForPicker,
    organizationId ? { organizationId } : 'skip',
  );
}
