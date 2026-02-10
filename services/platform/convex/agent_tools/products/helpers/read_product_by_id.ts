import type { ToolCtx } from '@convex-dev/agent';

import type { Doc, Id } from '../../../_generated/dataModel';

import { isKeyOf } from '../../../../lib/utils/type-guards';
import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
import { toId } from '../../../lib/type_cast_helpers';
import { defaultGetFields, type ProductReadGetByIdResult } from './types';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

async function fetchProduct(
  ctx: ToolCtx,
  productId: Id<'products'>,
): Promise<Doc<'products'> | null> {
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
      const productId = toId<'products'>(id);
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
        if (isKeyOf(f, product)) {
          out[f] = product[f];
        }
      }
      if (!('_id' in out)) {
        out._id = product._id;
      }
      return out;
    }),
  );

  const firstProduct = products[0];
  const presentKeys = firstProduct
    ? Object.keys(firstProduct).filter((k) => firstProduct[k] !== undefined)
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
