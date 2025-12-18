import type { ToolCtx } from '@convex-dev/agent';
import { internal } from '../../../_generated/api';
import { defaultListFields, type ProductReadListResult } from './types';

export async function readProductList(
  ctx: ToolCtx,
  args: { fields?: string[]; cursor?: string | null; numItems?: number },
): Promise<ProductReadListResult> {
  const { organizationId } = ctx;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for listing products',
    );
  }

  const numItems = args.numItems ?? 200;
  const cursor = args.cursor ?? null;
  const fields = args.fields ?? defaultListFields;

  const result: {
    items: Array<Record<string, unknown>>;
    isDone: boolean;
    continueCursor: string | null;
  } = await ctx.runQuery(internal.products.listByOrganization, {
    organizationId,
    paginationOpts: {
      numItems,
      cursor,
    },
    fields,
  });

  return {
    operation: 'list',
    products: result.items,
    pagination: {
      hasMore: !result.isDone,
      totalFetched: result.items.length,
      cursor: result.continueCursor,
    },
  };
}
