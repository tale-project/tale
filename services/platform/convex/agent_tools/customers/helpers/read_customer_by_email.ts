import type { ToolCtx } from '@convex-dev/agent';
import { internal } from '../../../_generated/api';
import { defaultGetFields, type CustomerReadGetByEmailResult } from './types';
import type { Customer } from '../../../customers/types';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

export async function readCustomerByEmail(
  ctx: ToolCtx,
  args: { email: string; fields?: string[] },
): Promise<CustomerReadGetByEmailResult> {
  const { organizationId } = ctx;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for email-based customer search',
    );
  }

  debugLog('tool:customer_read get_by_email start', {
    organizationId,
    email: args.email,
  });

  const customer = await ctx.runQuery(
    internal.customers.internal_queries.getCustomerByEmail,
    {
      organizationId,
      email: args.email,
    },
  );

  if (!customer) {
    debugLog('tool:customer_read get_by_email not found', {
      organizationId,
      email: args.email,
    });

    return {
      operation: 'get_by_email',
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
  debugLog('tool:customer_read get_by_email return', {
    email: args.email,
    presentKeys,
  });

  return {
    operation: 'get_by_email',
    customer: out,
  };
}
