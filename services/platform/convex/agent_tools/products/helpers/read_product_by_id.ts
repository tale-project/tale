import type { ToolCtx } from '@convex-dev/agent';

import type { Doc, Id } from '../../../_generated/dataModel';

import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
import { defaultGetFields, type ProductReadGetByIdResult } from './types';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

async function fetchProduct(
  ctx: ToolCtx,
  productId: Id<'products'>,
): Promise<Doc<'products'> | null> {
  // @ts-ignore TS2589: Convex API type instantiation is excessively deep
  return ctx.runQuery(internal.products.internal_queries.getProductById, {
    productId,
  });
}

export async function readProductsByIds(
  ctx: ToolCtx,
  args: { productIds: string[]; fields?: string[] },
): Promise<ProductReadGetByIdResult> {
  const { organizationId } = ctx;

  debugLog('tool:product_read get_by_id start', {
    organizationId,
    productIds: args.productIds,
  });

  const fields = args.fields ?? defaultGetFields;

  const products = await Promise.all(
    args.productIds.map(async (id) => {
      const productId = id as Id<'products'>;
      const product = await fetchProduct(ctx, productId);

      if (!product) {
        debugLog('tool:product_read get_by_id not found', {
          organizationId,
          productId: id,
        });
        return null;
      }

      const out: Record<string, unknown> = {};
      for (const f of fields) {
        out[f] = product[f as keyof Doc<'products'>];
      }
      if (!('_id' in out)) {
        out._id = product._id;
      }
      return out;
    }),
  );

  const presentKeys = products[0]
    ? Object.keys(products[0]).filter((k) => products[0]![k] !== undefined)
    : [];
  debugLog('tool:product_read get_by_id return', {
    productIds: args.productIds,
    count: products.length,
    presentKeys,
  });

  return {
    operation: 'get_by_id',
    products,
  };
}
