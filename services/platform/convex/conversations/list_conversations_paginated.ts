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
import { getContactsByIds } from './get_contacts_by_ids';
import { transformConversation } from './transform_conversation';
import type { ConversationItem, ConversationStatus } from './types';

interface ListConversationsPaginatedArgs {
  paginationOpts: PaginationOptions;
  organizationId: string;
  status?: ConversationStatus;
  priority?: string;
  channel?: string;
  connectorName?: string;
}

interface PaginatedConversationResult {
  page: ConversationItem[];
  isDone: boolean;
  continueCursor: string;
}

/**
 * Build a query ordered by lastMessageAt descending.
 *
 * When filtering by connector AND status (the per-provider email-app inbox),
 * uses `by_org_connector_status_lastMessageAt` so both filters and the sort
 * are index-backed. When filtering by status alone, uses
 * `by_org_status_lastMessageAt`. Otherwise uses `by_org_lastMessageAt` —
 * an connector-only filter is applied as a residual `.filter()` there,
 * since the compound index would order by status before recency.
 */
function buildOrderedQuery(
  ctx: QueryCtx,
  organizationId: string,
  status: ConversationStatus | undefined,
  connectorName: string | undefined,
) {
  if (connectorName !== undefined && status !== undefined) {
    return ctx.db
      .query('conversations')
      .withIndex('by_org_connector_status_lastMessageAt', (q) =>
        q
          .eq('organizationId', organizationId)
          .eq('connectorName', connectorName)
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
    args.connectorName,
  );

  // Residual connector filter — only when the compound index above did not
  // already consume it (connectorName without status).
  if (args.connectorName !== undefined && args.status === undefined) {
    const connectorName = args.connectorName;
    query = query.filter((q) => q.eq(q.field('connectorName'), connectorName));
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

  // Batch-fetch (and dedupe) the page's contacts once, then hand each
  // pre-resolved contact to transformConversation so it skips the per-row
  // ctx.db.get — collapsing the N+1 contact fan-out for the page. Rows with no
  // contactId get `null` here (no linked contact).
  const contactIds = result.page
    .map((c) => c.contactId)
    .filter((id): id is Id<'contacts'> => id !== undefined);
  const contacts = await getContactsByIds(ctx, contactIds);

  const page = await Promise.all(
    result.page.map((c) =>
      transformConversation(ctx, c, {
        contact: c.contactId ? (contacts.get(c.contactId) ?? null) : null,
      }),
    ),
  );

  return {
    page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}
