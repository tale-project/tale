import { fetchQuery } from 'convex/nextjs';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { getAuthToken } from '@/lib/auth/auth-server';

interface GetApprovalsDataParams {
  organizationId: string;
  status?: 'pending' | 'resolved';
  search?: string;
  page?: number;
}

export interface ApprovalsData {
  approvals: Doc<'approvals'>[];
  total: number;
}

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
 * Fetch approvals data from Convex using approvals table.
 *
 * @param params - Parameters for fetching approvals
 * @returns Promise<ApprovalsData> - Approval data
 */
export async function getApprovalsData({
  organizationId,
  status,
  search,
}: GetApprovalsDataParams): Promise<ApprovalsData> {
  try {
    const token = await getAuthToken();
    let approvals: Doc<'approvals'>[];

    // Exclude 'conversations' resourceType from approvals page
    const resourceType: Doc<'approvals'>['resourceType'][] = [
      'product_recommendation',
    ]; // Add other types as needed, but exclude 'conversations'

    if (status === 'pending') {
      // Fetch only pending approvals with limit
      const result = await fetchQuery(
        api.approvals.getApprovalsByOrganization,
        {
          organizationId: organizationId as string,
          status: 'pending',
          resourceType,
          limit: 500, // Reasonable limit for UI display
        },
        token ? { token } : undefined,
      );
      approvals = result as unknown as Doc<'approvals'>[];
    } else if (status === 'resolved') {
      // Fetch resolved approvals (approved/rejected) with limit
      const result = await fetchQuery(
        api.approvals.getApprovalsByOrganization,
        {
          organizationId: organizationId as string,
          status: 'resolved',
          resourceType,
          limit: 500, // Reasonable limit for UI display
        },
        token ? { token } : undefined,
      );
      approvals = result as unknown as Doc<'approvals'>[];
    } else {
      // Fetch all approvals with limit (default to resolved view)
      const result = await fetchQuery(
        api.approvals.getApprovalsByOrganization,
        {
          organizationId: organizationId as string,
          status: 'resolved',
          resourceType,
          limit: 500, // Reasonable limit for UI display
        },
        token ? { token } : undefined,
      );
      approvals = result as unknown as Doc<'approvals'>[];
    }

    // Apply search filter
    const filteredApprovals = filterApprovals(approvals, search);

    return {
      approvals: filteredApprovals,
      total: filteredApprovals.length,
    };
  } catch (error) {
    console.error('Error fetching approvals:', error);
    return {
      approvals: [],
      total: 0,
    };
  }
}
