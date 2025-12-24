import type { ToolCtx } from '@convex-dev/agent';
import { internal } from '../../../_generated/api';
import type { CustomerReadListResult } from './types';

export async function readCustomerList(
  ctx: ToolCtx,
  args: { cursor?: string | null; numItems?: number },
): Promise<CustomerReadListResult> {
  const { organizationId } = ctx;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for listing customers',
    );
  }

  const numItems = args.numItems ?? 200;
  const cursor = args.cursor ?? null;

  const result = await ctx.runQuery(internal.customers.queryCustomers, {
    organizationId,
    paginationOpts: {
      numItems,
      cursor,
    },
  });

  return {
    operation: 'list',
    customers: result.page,
    pagination: {
      hasMore: !result.isDone,
      totalFetched: result.page.length,
      cursor: result.continueCursor || null,
    },
  };
}
