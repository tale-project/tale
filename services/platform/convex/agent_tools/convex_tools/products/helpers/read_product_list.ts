import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import { defaultListFields, type ProductReadListResult } from './types';

export async function readProductList(
  ctx: unknown,
  args: { fields?: string[]; cursor?: string | null; numItems?: number },
): Promise<ProductReadListResult> {
  const actionCtx = ctx as unknown as ActionCtx;
  const organizationId = (ctx as unknown as { organizationId?: string })
    .organizationId;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for listing products',
    );
  }

  const numItems = args.numItems ?? 200;
  const cursor = args.cursor ?? null;
  const fields = args.fields ?? defaultListFields;

  const result: {
    page: Array<Record<string, unknown>>;
    isDone: boolean;
    continueCursor: string | null;
  } = await actionCtx.runQuery(internal.products.listByOrganization, {
    organizationId,
    paginationOpts: {
      numItems,
      cursor,
    },
    fields,
  });

  return {
    operation: 'list',
    products: result.page,
    pagination: {
      hasMore: !result.isDone,
      totalFetched: result.page.length,
      cursor: result.continueCursor,
    },
  };
}
