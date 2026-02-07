import type { ToolCtx } from '@convex-dev/agent';
import { internal } from '../../../_generated/api';
import type { CustomerReadCountResult } from './types';

const MAX_PAGINATION_ATTEMPTS = 3;
const COUNT_PAGE_SIZE = 500;

type PaginationResult = {
  page: Array<Record<string, unknown>>;
  isDone: boolean;
  continueCursor: string;
};

export async function countCustomers(
  ctx: ToolCtx,
): Promise<CustomerReadCountResult> {
  const { organizationId } = ctx;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for counting customers',
    );
  }

  let totalCount = 0;
  let cursor: string | null = null;
  let attempts = 0;

  while (attempts < MAX_PAGINATION_ATTEMPTS) {
    attempts++;

    // @ts-ignore TS2589: Convex API type instantiation is excessively deep (known Convex limitation with deeply nested internal query types)
    const queryFn = internal.customers.internal_queries.queryCustomers;
    const result: PaginationResult = await ctx.runQuery(queryFn, {
      organizationId,
      paginationOpts: {
        numItems: COUNT_PAGE_SIZE,
        cursor,
      },
    });

    totalCount += result.page.length;

    if (result.isDone) {
      return {
        operation: 'count',
        count: totalCount,
        message: `Total customers: ${totalCount}`,
        isComplete: true,
      };
    }

    cursor = result.continueCursor;
  }

  return {
    operation: 'count',
    count: null,
    message: `Unable to count: data volume exceeds system limits (>${totalCount} customers). Tell the user directly that the customer count cannot be calculated due to large data volume. DO NOT attempt workarounds.`,
    isComplete: false,
  };
}
