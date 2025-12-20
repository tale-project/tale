import { preloadQuery, type Preloaded } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { getAuthToken } from '@/lib/auth/auth-server';

interface GetApprovalsDataParams {
  organizationId: string;
  status?: 'pending' | 'resolved';
  search?: string;
  page?: number;
}

export type PreloadedApprovals = Preloaded<
  typeof api.approvals.getApprovalsByOrganization
>;

/**
 * Apply search filter to approvals based on customer name, email, and product names.
 */
function filterApprovals(
  approvals: Doc<'approvals'>[],
  search?: string,
): Doc<'approvals'>[] {
  if (!search) return approvals;

  const searchLower = search.toLowerCase();

  return approvals.filter((approval) => {
    const metadata = approval.metadata || {};

    // Search in customer info
    if (metadata.customerName?.toLowerCase().includes(searchLower)) return true;
    if (metadata.customerEmail?.toLowerCase().includes(searchLower))
      return true;

    // Search in event products
    if (
      Array.isArray(metadata.eventProducts) &&
      metadata.eventProducts.some((p: Record<string, unknown>) => {
        const name =
          (typeof p['name'] === 'string' && (p['name'] as string)) ||
          (typeof p['product_name'] === 'string' &&
            (p['product_name'] as string)) ||
          (typeof p['productName'] === 'string' &&
            (p['productName'] as string)) ||
          '';
        return name.toLowerCase().includes(searchLower);
      })
    )
      return true;

    // Search in recommended products (canonical: productName)
    if (
      Array.isArray(metadata.recommendedProducts) &&
      metadata.recommendedProducts.some((p: Record<string, unknown>) => {
        const name =
          (typeof p['productName'] === 'string' &&
            (p['productName'] as string)) ||
          '';
        return name.toLowerCase().includes(searchLower);
      })
    )
      return true;

    return false;
  });
}

/**
 * Preload approvals data from Convex for SSR + real-time reactivity.
 * Uses preloadQuery to enable usePreloadedQuery on the client.
 *
 * @param params - Parameters for fetching approvals
 * @returns Promise<PreloadedApprovals> - Preloaded approval data
 */
export async function preloadApprovalsData({
  organizationId,
  status,
}: Omit<
  GetApprovalsDataParams,
  'search' | 'page'
>): Promise<PreloadedApprovals> {
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
      limit: 500, // Reasonable limit for UI display
    },
    token ? { token } : undefined,
  );
}
