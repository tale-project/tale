/**
 * List approvals for an organization with a simple status + resourceType filter.
 *
 * - `status` is a high-level view: `pending` or `resolved` (approved or rejected).
 * - `resourceType` can be a string or an array of strings; filtering is done in code.
 * - `search` is an optional search term to filter by customer name, email, or product names.
 * - We iterate the query one-by-one and stop when we reach `limit` matches.
 */

import { QueryCtx } from '../../_generated/server';
import { ApprovalItem } from './types';

export interface ListApprovalsByOrganizationArgs {
  organizationId: string;
  status: 'pending' | 'resolved';
  resourceType?: string | string[];
  search?: string;
  limit?: number;
}

/**
 * Check if an approval matches the search term.
 * Searches in customer name, email, and product names from metadata.
 */
function matchesSearch(approval: ApprovalItem, searchLower: string): boolean {
  const metadata = (approval.metadata || {}) as Record<string, unknown>;

  // Search in customer name
  if (
    typeof metadata['customerName'] === 'string' &&
    (metadata['customerName'] as string).toLowerCase().includes(searchLower)
  ) {
    return true;
  }

  // Search in customer email
  if (
    typeof metadata['customerEmail'] === 'string' &&
    (metadata['customerEmail'] as string).toLowerCase().includes(searchLower)
  ) {
    return true;
  }

  // Search in recommended products (canonical: productName)
  if (Array.isArray(metadata['recommendedProducts'])) {
    const products = metadata['recommendedProducts'] as Array<
      Record<string, unknown>
    >;
    if (
      products.some((p) => {
        const name =
          typeof p['productName'] === 'string'
            ? (p['productName'] as string)
            : '';
        return name.toLowerCase().includes(searchLower);
      })
    ) {
      return true;
    }
  }

  return false;
}

export async function listApprovalsByOrganization(
  ctx: QueryCtx,
  args: ListApprovalsByOrganizationArgs,
): Promise<Array<ApprovalItem>> {
  const limit = args.limit ?? 1000; // Default limit to prevent unbounded queries
  const searchLower = args.search?.trim().toLowerCase();

  // Normalize resourceType into an array for easier handling
  const resourceTypes: string[] =
    typeof args.resourceType === 'string'
      ? [args.resourceType]
      : Array.isArray(args.resourceType)
        ? args.resourceType
        : [];
  const resourceTypeSet =
    resourceTypes.length > 0 ? new Set(resourceTypes) : undefined;

  const result: Array<ApprovalItem> = [];

  if (args.status === 'pending') {
    // Pending view: only pending approvals
    const query = ctx.db
      .query('approvals')
      .withIndex('by_org_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', 'pending'),
      )
      .order('desc');

    for await (const approval of query) {
      if (resourceTypeSet && !resourceTypeSet.has(approval.resourceType)) {
        continue;
      }

      // Apply search filter if provided
      if (searchLower && !matchesSearch(approval, searchLower)) {
        continue;
      }

      result.push(approval);
      if (result.length >= limit) break;
    }

    // Ensure results are ordered by creation time (newest first)
    result.sort((a, b) => b._creationTime - a._creationTime);
    return result;
  }

  // Resolved view: approved first, then rejected
  const approvedQuery = ctx.db
    .query('approvals')
    .withIndex('by_org_status', (q) =>
      q.eq('organizationId', args.organizationId).eq('status', 'approved'),
    )
    .order('desc');

  for await (const approval of approvedQuery) {
    if (resourceTypeSet && !resourceTypeSet.has(approval.resourceType)) {
      continue;
    }

    // Apply search filter if provided
    if (searchLower && !matchesSearch(approval, searchLower)) {
      continue;
    }

    result.push(approval);
    if (result.length >= limit) {
      result.sort((a, b) => b._creationTime - a._creationTime);
      return result;
    }
  }

  const rejectedQuery = ctx.db
    .query('approvals')
    .withIndex('by_org_status', (q) =>
      q.eq('organizationId', args.organizationId).eq('status', 'rejected'),
    )
    .order('desc');

  for await (const approval of rejectedQuery) {
    if (resourceTypeSet && !resourceTypeSet.has(approval.resourceType)) {
      continue;
    }

    // Apply search filter if provided
    if (searchLower && !matchesSearch(approval, searchLower)) {
      continue;
    }

    result.push(approval);
    if (result.length >= limit) {
      result.sort((a, b) => b._creationTime - a._creationTime);
      return result;
    }
  }

  // Final sort by creation time (newest first) before returning
  result.sort((a, b) => b._creationTime - a._creationTime);
  return result;
}
