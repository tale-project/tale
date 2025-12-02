import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import { defaultGetFields, type CustomerReadGetByEmailResult } from './types';

export async function readCustomerByEmail(
  ctx: unknown,
  args: { email: string; fields?: string[] },
): Promise<CustomerReadGetByEmailResult> {
  const actionCtx = ctx as ActionCtx;
  const organizationId = (ctx as unknown as { organizationId?: string })
    .organizationId;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for email-based customer search',
    );
  }

  console.log('[tool:customer_read] get_by_email start', {
    organizationId,
    email: args.email,
  });

  const customer = await actionCtx.runQuery(
    internal.customers.getCustomerByEmailInternal,
    {
      organizationId,
      email: args.email,
    },
  );

  if (!customer) {
    console.log('[tool:customer_read] get_by_email not found', {
      organizationId,
      email: args.email,
    });

    return {
      operation: 'get_by_email',
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
  console.log('[tool:customer_read] get_by_email return', {
    email: args.email,
    presentKeys,
  });

  return {
    operation: 'get_by_email',
    customer: out,
  };
}
