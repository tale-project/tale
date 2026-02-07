import type { ToolCtx } from '@convex-dev/agent';
import { internal } from '../../../_generated/api';
import type { ProductStatus } from '../../../products/types';
import type { ProductReadCountResult } from './types';

const MAX_PAGINATION_ATTEMPTS = 3;
const COUNT_PAGE_SIZE = 500;

export interface CountProductsArgs {
  status?: ProductStatus;
  minStock?: number;
}

export async function countProducts(
  ctx: ToolCtx,
  args: CountProductsArgs,
): Promise<ProductReadCountResult> {
  const { organizationId } = ctx;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for counting products',
    );
  }

  let totalCount = 0;
  let cursor: string | null = null;
  let attempts = 0;

  while (attempts < MAX_PAGINATION_ATTEMPTS) {
    attempts++;

    // @ts-ignore TS2589: Convex API type instantiation is excessively deep (known Convex limitation with deeply nested internal query types)
    const result = (await ctx.runQuery(internal.products.internal_queries.queryProducts, {
      organizationId,
      status: args.status,
      minStock: args.minStock,
      paginationOpts: {
        numItems: COUNT_PAGE_SIZE,
        cursor,
      },
    })) as {
      page: Array<Record<string, unknown>>;
      isDone: boolean;
      continueCursor: string;
    };

    totalCount += result.page.length;

    if (result.isDone) {
      return {
        operation: 'count',
        count: totalCount,
        message: `Total products: ${totalCount}`,
        isComplete: true,
      };
    }

    cursor = result.continueCursor;
  }

  return {
    operation: 'count',
    count: null,
    message: `Unable to count: data volume exceeds system limits (>${totalCount} products). Tell the user directly that the product count cannot be calculated due to large data volume. DO NOT attempt workarounds.`,
    isComplete: false,
  };
}
