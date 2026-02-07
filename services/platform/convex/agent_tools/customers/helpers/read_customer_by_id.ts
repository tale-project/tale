import type { ToolCtx } from '@convex-dev/agent';
import type { Id } from '../../../_generated/dataModel';
import { internal } from '../../../_generated/api';
import { defaultGetFields, type CustomerReadGetByIdResult } from './types';
import type { Customer } from '../../../customers/types';

import { createDebugLog } from '../../../lib/debug_log';

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

  // Cast string to Id at the boundary - validated by Convex runtime
  const customerId = args.customerId as Id<'customers'>;

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
    out[f] = customer[f as keyof Customer];
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
