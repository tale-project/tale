/**
 * Approvals Helpers - Business Logic
 *
 * Consolidated business logic functions for approvals domain.
 */

import type { QueryCtx, MutationCtx } from '../_generated/server';
import type { Id, Doc } from '../_generated/dataModel';
import { components } from '../_generated/api';
import type {
  ApprovalItem,
  ApprovalResourceType,
  CreateApprovalArgs,
  UpdateApprovalStatusArgs,
  GetApprovalHistoryArgs,
  ListPendingApprovalsArgs,
  ListApprovalsByOrganizationArgs,
  RemoveRecommendedProductArgs,
  LinkApprovalsToMessageArgs,
} from './types';

type ApprovalMetadata = Doc<'approvals'>['metadata'];

// =============================================================================
// QUERY HELPERS
// =============================================================================

export async function getApproval(
  ctx: QueryCtx,
  approvalId: Id<'approvals'>,
): Promise<ApprovalItem | null> {
  return await ctx.db.get(approvalId);
}

export async function getApprovalHistory(
  ctx: QueryCtx,
  args: GetApprovalHistoryArgs,
): Promise<Array<ApprovalItem>> {
  const approvals: Array<ApprovalItem> = [];
  for await (const approval of ctx.db
    .query('approvals')
    .withIndex('by_resource', (q) =>
      q.eq('resourceType', args.resourceType).eq('resourceId', args.resourceId),
    )
    .order('desc')) {
    approvals.push(approval);
  }
  return approvals;
}

export async function getPendingApprovalForResource(
  ctx: QueryCtx,
  args: GetApprovalHistoryArgs,
): Promise<ApprovalItem | null> {
  const approvals = await ctx.db
    .query('approvals')
    .withIndex('by_resourceType_and_resourceId_and_status', (q) =>
      q
        .eq('resourceType', args.resourceType)
        .eq('resourceId', args.resourceId)
        .eq('status', 'pending'),
    )
    .order('desc')
    .take(1);

  return approvals[0] || null;
}

export async function listPendingApprovals(
  ctx: QueryCtx,
  args: ListPendingApprovalsArgs,
): Promise<Array<ApprovalItem>> {
  const limit = args.limit ?? 1000;

  if (args.resourceType) {
    const resourceType = args.resourceType;
    return await ctx.db
      .query('approvals')
      .withIndex('by_org_status_resourceType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('status', 'pending')
          .eq('resourceType', resourceType),
      )
      .order('desc')
      .take(limit);
  }

  return await ctx.db
    .query('approvals')
    .withIndex('by_org_status', (q) =>
      q.eq('organizationId', args.organizationId).eq('status', 'pending'),
    )
    .order('desc')
    .take(limit);
}

export async function listPendingApprovalsForExecution(
  ctx: QueryCtx,
  executionId: Id<'wfExecutions'>,
): Promise<Array<ApprovalItem>> {
  const pendingApprovals: Array<ApprovalItem> = [];

  for await (const approval of ctx.db
    .query('approvals')
    .withIndex('by_execution', (q) => q.eq('wfExecutionId', executionId))
    .order('desc')) {
    if (approval.status === 'pending') {
      pendingApprovals.push(approval);
    }
  }

  return pendingApprovals;
}

export async function listApprovalsForExecution(
  ctx: QueryCtx,
  executionId: Id<'wfExecutions'>,
): Promise<Array<ApprovalItem>> {
  const approvals: Array<ApprovalItem> = [];
  for await (const approval of ctx.db
    .query('approvals')
    .withIndex('by_execution', (q) => q.eq('wfExecutionId', executionId))
    .order('desc')) {
    approvals.push(approval);
  }
  return approvals;
}

function matchesSearch(approval: ApprovalItem, searchLower: string): boolean {
  const metadata = (approval.metadata || {}) as Record<string, unknown>;

  if (
    typeof metadata['customerName'] === 'string' &&
    (metadata['customerName'] as string).toLowerCase().includes(searchLower)
  ) {
    return true;
  }

  if (
    typeof metadata['customerEmail'] === 'string' &&
    (metadata['customerEmail'] as string).toLowerCase().includes(searchLower)
  ) {
    return true;
  }

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
  const limit = args.limit ?? 1000;
  const searchLower = args.search?.trim().toLowerCase();

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

      if (searchLower && !matchesSearch(approval, searchLower)) {
        continue;
      }

      result.push(approval);
      if (result.length >= limit) break;
    }

    result.sort((a, b) => b._creationTime - a._creationTime);
    return result;
  }

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

    if (searchLower && !matchesSearch(approval, searchLower)) {
      continue;
    }

    result.push(approval);
    if (result.length >= limit) {
      result.sort((a, b) => b._creationTime - a._creationTime);
      return result;
    }
  }

  result.sort((a, b) => b._creationTime - a._creationTime);
  return result;
}

// =============================================================================
// MUTATION HELPERS
// =============================================================================

export async function createApproval(
  ctx: MutationCtx,
  args: CreateApprovalArgs,
): Promise<Id<'approvals'>> {
  const approvalId = await ctx.db.insert('approvals', {
    organizationId: args.organizationId,
    wfExecutionId: args.wfExecutionId,
    stepSlug: args.stepSlug,
    status: 'pending',
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    priority: args.priority,
    dueDate: args.dueDate,
    threadId: args.threadId,
    messageId: args.messageId,
    metadata: {
      createdAt: Date.now(),
      ...(args.requestedBy ? { requestedBy: args.requestedBy } : {}),
      ...(args.description ? { description: args.description } : {}),
      ...(args.metadata as Record<string, unknown>),
    },
  });

  return approvalId;
}

export async function updateApprovalStatus(
  ctx: MutationCtx,
  args: UpdateApprovalStatusArgs,
): Promise<void> {
  const current = await ctx.db.get(args.approvalId);
  if (!current) {
    throw new Error('Approval not found');
  }

  let approverName: string | undefined;
  const userRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'user',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [{ field: '_id', value: args.approvedBy, operator: 'eq' }],
  });
  const user = userRes?.page?.[0];
  if (user) {
    approverName = (user.name as string) || (user.email as string);
  }

  await ctx.db.patch(args.approvalId, {
    status: args.status,
    approvedBy: args.approvedBy,
    reviewedAt: Date.now(),
    metadata: {
      ...(current.metadata as Record<string, unknown>),
      ...(args.comments ? { comments: args.comments } : {}),
      ...(approverName ? { approverName } : {}),
    },
  });
}

export async function removeRecommendedProduct(
  ctx: MutationCtx,
  args: RemoveRecommendedProductArgs,
): Promise<void> {
  const approval = await ctx.db.get(args.approvalId);
  if (!approval) {
    throw new Error('Approval not found');
  }

  if (approval.status !== 'pending') {
    throw new Error('Cannot modify products in non-pending approvals');
  }

  const metadata = approval.metadata || {};
  const recommendedProducts = Array.isArray(metadata.recommendedProducts)
    ? metadata.recommendedProducts
    : [];

  const updatedProducts = recommendedProducts.filter((product: unknown) => {
    if (typeof product !== 'object' || product === null || Array.isArray(product)) {
      return true;
    }
    const id = (product as Record<string, unknown>)['productId'];
    return id !== args.productId;
  });

  await ctx.db.patch(args.approvalId, {
    metadata: {
      ...metadata,
      recommendedProducts: updatedProducts,
    } as ApprovalMetadata,
  });
}

export async function linkApprovalsToMessage(
  ctx: MutationCtx,
  args: LinkApprovalsToMessageArgs,
): Promise<number> {
  const { threadId, messageId } = args;

  const resourceTypesToLink = [
    'integration_operation',
    'workflow_creation',
    'human_input_request',
  ] as const;

  const approvalIds: Array<Id<'approvals'>> = [];

  for (const resourceType of resourceTypesToLink) {
    const query = ctx.db
      .query('approvals')
      .withIndex('by_threadId_status_resourceType', (q) =>
        q
          .eq('threadId', threadId)
          .eq('status', 'pending')
          .eq('resourceType', resourceType),
      )
      .filter((q) => q.eq(q.field('messageId'), undefined));

    for await (const approval of query) {
      approvalIds.push(approval._id);
    }
  }

  await Promise.all(
    approvalIds.map((id) => ctx.db.patch(id, { messageId })),
  );

  return approvalIds.length;
}
