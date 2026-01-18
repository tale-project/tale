import type { ToolCtx } from '@convex-dev/agent';
import { internal } from '../../../_generated/api';
import type { ProductReadListResult } from './types';

export async function readProductList(
  ctx: ToolCtx,
  args: { cursor?: string | null; numItems?: number },
): Promise<ProductReadListResult> {
  const { organizationId } = ctx;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for listing products',
    );
  }

  const numItems = args.numItems ?? 200;
  const cursor = args.cursor ?? null;

  const result = await ctx.runQuery(internal.products.queries.listByOrganization, {
    organizationId,
    paginationOpts: {
      numItems,
      cursor,
    },
  });

  return {
    operation: 'list',
    products: result.page,
    pagination: {
      hasMore: !result.isDone,
      totalFetched: result.page.length,
      cursor: result.continueCursor || null,
    },
  };
}
