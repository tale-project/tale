import type { ToolCtx } from '@convex-dev/agent';

import type { ProductStatus } from '../../../products/types';
import type { ProductReadListResult } from './types';

import { internal } from '../../../_generated/api';
import { defaultListFields } from './types';

export interface ReadProductListArgs {
  cursor?: string | null;
  numItems?: number;
  status?: ProductStatus;
  minStock?: number;
}

export async function readProductList(
  ctx: ToolCtx,
  args: ReadProductListArgs,
): Promise<ProductReadListResult> {
  const { organizationId } = ctx;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for listing products',
    );
  }

  const numItems = args.numItems ?? 50;
  const cursor = args.cursor ?? null;

  const result = (await ctx.runQuery(
    internal.products.internal_queries.queryProducts,
    {
      organizationId,
      status: args.status,
      minStock: args.minStock,
      paginationOpts: {
        numItems,
        cursor,
      },
    },
  )) as {
    page: Array<Record<string, unknown>>;
    isDone: boolean;
    continueCursor: string;
  };

  const products = result.page;

  const filteredProducts = products.map((product) => {
    const filtered: Record<string, unknown> = {};
    for (const field of defaultListFields) {
      if (field in product) {
        filtered[field] = product[field];
      }
    }
    return filtered;
  });

  return {
    operation: 'list',
    products: filteredProducts,
    pagination: {
      hasMore: !result.isDone,
      totalFetched: filteredProducts.length,
      cursor: result.continueCursor || null,
    },
  };
}
