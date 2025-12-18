import type { ToolCtx } from '@convex-dev/agent';
import { internal } from '../../../_generated/api';
import { defaultListFields, type CustomerReadListResult } from './types';

export async function readCustomerList(
  ctx: ToolCtx,
  args: { fields?: string[]; cursor?: string | null; numItems?: number },
): Promise<CustomerReadListResult> {
  const { organizationId } = ctx;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for listing customers',
    );
  }

  const numItems = args.numItems ?? 200;
  const cursor = args.cursor ?? null;
  const fields = args.fields ?? defaultListFields;

  const result: {
    items: Array<Record<string, unknown>>;
    isDone: boolean;
    continueCursor: string | null;
    count: number;
  } = await ctx.runQuery(internal.customers.queryCustomers, {
    organizationId,
    paginationOpts: {
      numItems,
      cursor,
    },
    fields,
  });

  return {
    operation: 'list',
    customers: result.items,
    pagination: {
      hasMore: !result.isDone,
      totalFetched: result.items.length,
      cursor: result.continueCursor,
    },
  };
}
