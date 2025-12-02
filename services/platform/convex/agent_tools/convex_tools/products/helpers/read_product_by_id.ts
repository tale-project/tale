import type { ActionCtx } from '../../../../_generated/server';
import type { Id } from '../../../../_generated/dataModel';
import { internal } from '../../../../_generated/api';
import { defaultGetFields, type ProductReadGetByIdResult } from './types';

import { createDebugLog } from '../../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

export async function readProductById(
  ctx: unknown,
  args: { productId: string; fields?: string[] },
): Promise<ProductReadGetByIdResult> {
  const organizationId = (ctx as { organizationId?: string }).organizationId;

  debugLog('tool:product_read get_by_id start', {
    organizationId,
    productId: args.productId,
  });

  const actionCtx = ctx as ActionCtx;
  const product = await actionCtx.runQuery(internal.products.getProductById, {
    productId: args.productId as Id<'products'>,
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

  const out: Record<string, unknown> = {};
  const productRecord = product as Record<string, unknown>;
  for (const f of fields) {
    out[f] = productRecord[f];
  }
  if (!('_id' in out)) {
    out._id = productRecord._id;
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
