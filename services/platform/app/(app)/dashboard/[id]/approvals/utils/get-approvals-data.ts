import { preloadQuery, type Preloaded } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { getAuthToken } from '@/lib/auth/auth-server';

interface GetApprovalsDataParams {
  organizationId: string;
  status?: 'pending' | 'resolved';
  search?: string;
}

export type PreloadedApprovals = Preloaded<
  typeof api.approvals.getApprovalsByOrganization
>;

/**
 * Preload approvals data from Convex for SSR + real-time reactivity.
 * Uses preloadQuery to enable usePreloadedQuery on the client.
 * Search filtering is now done server-side in the Convex query.
 *
 * @param params - Parameters for fetching approvals
 * @returns Promise<PreloadedApprovals> - Preloaded approval data
 */
export async function preloadApprovalsData({
  organizationId,
  status,
  search,
}: GetApprovalsDataParams): Promise<PreloadedApprovals> {
  const token = await getAuthToken();

  // Exclude 'conversations' resourceType from approvals page
  const resourceType: Doc<'approvals'>['resourceType'][] = [
    'product_recommendation',
  ]; // Add other types as needed, but exclude 'conversations'

  const queryStatus = status === 'pending' ? 'pending' : 'resolved';

  return preloadQuery(
    api.approvals.getApprovalsByOrganization,
    {
      organizationId,
      status: queryStatus,
      resourceType,
      search: search || undefined,
      limit: 500, // Reasonable limit for UI display
    },
    token ? { token } : undefined,
  );
}
