import type { ToolCtx } from '@convex-dev/agent';
import type { Doc, Id } from '../../../_generated/dataModel';
import { internal } from '../../../_generated/api';
import { defaultGetFields, type ProductReadGetByIdResult } from './types';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

export async function readProductById(
  ctx: ToolCtx,
  args: { productId: string; fields?: string[] },
): Promise<ProductReadGetByIdResult> {
  const { organizationId } = ctx;

  debugLog('tool:product_read get_by_id start', {
    organizationId,
    productId: args.productId,
  });

  // Cast string to Id at the boundary - validated by Convex runtime
  const productId = args.productId as Id<'products'>;

  const product = await ctx.runQuery(internal.products.queries.getProductById, {
    productId,
  });

  if (!product) {
    debugLog('tool:product_read get_by_id not found', {
      organizationId,
      productId: args.productId,
    });

    return {
      operation: 'get_by_id',
      product: null,
    };
  }

  const fields = args.fields ?? defaultGetFields;

  // Build output with selected fields - product type is known from query
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    out[f] = product[f as keyof Doc<'products'>];
  }
  if (!('_id' in out)) {
    out._id = product._id;
  }

  const presentKeys = Object.keys(out).filter((k) => out[k] !== undefined);
  debugLog('tool:product_read get_by_id return', {
    productId: args.productId,
    presentKeys,
  });

  return {
    operation: 'get_by_id',
    product: out,
  };
}
