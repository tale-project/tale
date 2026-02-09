import type { ToolCtx } from '@convex-dev/agent';

import { isKeyOf } from '../../../../lib/utils/type-guards';
import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
import { toId } from '../../../lib/type_cast_helpers';
import { defaultGetFields, type CustomerReadGetByIdResult } from './types';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

export async function readCustomerById(
  ctx: ToolCtx,
  args: { customerId: string; fields?: string[] },
): Promise<CustomerReadGetByIdResult> {
  const { organizationId } = ctx;

  debugLog('tool:customer_read get_by_id start', {
    organizationId,
    customerId: args.customerId,
  });

  const customerId = toId<'customers'>(args.customerId);

  const customer = await ctx.runQuery(
    internal.customers.internal_queries.getCustomerById,
    { customerId },
  );

  if (!customer) {
    debugLog('tool:customer_read get_by_id not found', {
      organizationId,
      customerId: args.customerId,
    });

    return {
      operation: 'get_by_id',
      customer: null,
    };
  }

  const fields = args.fields ?? defaultGetFields;

  // Build output with selected fields - customer type is known from query
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (isKeyOf(f, customer)) {
      out[f] = customer[f];
    }
  }
  if (!('_id' in out)) {
    out._id = customer._id;
  }

  const presentKeys = Object.keys(out).filter((k) => out[k] !== undefined);
  debugLog('tool:customer_read get_by_id return', {
    customerId: args.customerId,
    presentKeys,
  });

  return {
    operation: 'get_by_id',
    customer: out,
  };
}
