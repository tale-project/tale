import type { ActionCtx } from '../../../../_generated/server';
import type { Id } from '../../../../_generated/dataModel';
import { internal } from '../../../../_generated/api';
import { defaultGetFields, type CustomerReadGetByIdResult } from './types';

export async function readCustomerById(
  ctx: unknown,
  args: { customerId: string; fields?: string[] },
): Promise<CustomerReadGetByIdResult> {
  const organizationId = (ctx as { organizationId?: string }).organizationId;

  console.log('[tool:customer_read] get_by_id start', {
    organizationId,
    customerId: args.customerId,
  });

  const actionCtx = ctx as ActionCtx;
  const customer = await actionCtx.runQuery(
    internal.customers.getCustomerById,
    {
      customerId: args.customerId as Id<'customers'>,
    },
  );

  if (!customer) {
    console.log('[tool:customer_read] get_by_id not found', {
      organizationId,
      customerId: args.customerId,
    });

    return {
      operation: 'get_by_id',
      customer: null,
    };
  }

  const fields = args.fields ?? defaultGetFields;

  const out: Record<string, unknown> = {};
  const customerRecord = customer as Record<string, unknown>;
  for (const f of fields) {
    out[f] = customerRecord[f];
  }
  if (!('_id' in out)) {
    out._id = customerRecord._id;
  }

  const presentKeys = Object.keys(out).filter((k) => out[k] !== undefined);
  console.log('[tool:customer_read] get_by_id return', {
    customerId: args.customerId,
    presentKeys,
  });

  return {
    operation: 'get_by_id',
    customer: out,
  };
}
