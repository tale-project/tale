/**
 * List conversations using Convex native .paginate() for use with usePaginatedQuery.
 *
 * Dispatches to the best 2-field compound index based on the primary active
 * filter, then applies .filter() for any remaining filters.
 * After pagination, transforms each conversation with customer/message data.
 */

import type { PaginationOptions } from 'convex/server';

import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { getCustomersByIds } from './get_customers_by_ids';
import { transformConversation } from './transform_conversation';
import type { ConversationItem, ConversationStatus } from './types';

interface ListConversationsPaginatedArgs {
  paginationOpts: PaginationOptions;
  organizationId: string;
  status?: ConversationStatus;
  priority?: string;
  channel?: string;
  integrationName?: string;
}

interface PaginatedConversationResult {
  page: ConversationItem[];
  isDone: boolean;
  continueCursor: string;
}

/**
 * Build a query ordered by lastMessageAt descending.
 *
 * When filtering by integration AND status (the per-provider email-app inbox),
 * uses `by_org_integration_status_lastMessageAt` so both filters and the sort
 * are index-backed. When filtering by status alone, uses
 * `by_org_status_lastMessageAt`. Otherwise uses `by_org_lastMessageAt` —
 * an integration-only filter is applied as a residual `.filter()` there,
 * since the compound index would order by status before recency.
 */
function buildOrderedQuery(
  ctx: QueryCtx,
  organizationId: string,
  status: ConversationStatus | undefined,
  integrationName: string | undefined,
) {
  if (integrationName !== undefined && status !== undefined) {
    return ctx.db
      .query('conversations')
      .withIndex('by_org_integration_status_lastMessageAt', (q) =>
        q
          .eq('organizationId', organizationId)
          .eq('integrationName', integrationName)
          .eq('status', status),
      )
      .order('desc');
  }

  if (status !== undefined) {
    return ctx.db
      .query('conversations')
      .withIndex('by_org_status_lastMessageAt', (q) =>
        q.eq('organizationId', organizationId).eq('status', status),
      )
      .order('desc');
  }

  return ctx.db
    .query('conversations')
    .withIndex('by_org_lastMessageAt', (q) =>
      q.eq('organizationId', organizationId),
    )
    .order('desc');
}

export async function listConversationsPaginated(
  ctx: QueryCtx,
  args: ListConversationsPaginatedArgs,
): Promise<PaginatedConversationResult> {
  let query = buildOrderedQuery(
    ctx,
    args.organizationId,
    args.status,
    args.integrationName,
  );

  // Residual integration filter — only when the compound index above did not
  // already consume it (integrationName without status).
  if (args.integrationName !== undefined && args.status === undefined) {
    const integrationName = args.integrationName;
    query = query.filter((q) =>
      q.eq(q.field('integrationName'), integrationName),
    );
  }
  if (args.priority !== undefined) {
    const priority = args.priority;
    query = query.filter((q) => q.eq(q.field('priority'), priority));
  }
  if (args.channel !== undefined) {
    const channel = args.channel;
    query = query.filter((q) => q.eq(q.field('channel'), channel));
  }

  const result = await query.paginate(args.paginationOpts);

  // Batch-fetch (and dedupe) the page's customers once, then hand each
  // pre-resolved customer to transformConversation so it skips the per-row
  // ctx.db.get — collapsing the N+1 customer fan-out for the page.
  const customerIds = result.page
    .map((c) => c.customerId)
    .filter((id): id is Id<'customers'> => id !== undefined);
  const customers = await getCustomersByIds(ctx, customerIds);

  const page = await Promise.all(
    result.page.map((c) =>
      transformConversation(ctx, c, {
        customer: c.customerId ? (customers.get(c.customerId) ?? null) : null,
      }),
    ),
  );

  return {
    page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}
