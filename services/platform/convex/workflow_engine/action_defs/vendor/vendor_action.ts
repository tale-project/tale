/**
 * Vendor workflow action — create/update/read vendors (suppliers) from
 * automations. Thin wrapper over `vendors/internal_mutations.ts` +
 * `vendors/internal_queries.ts`. Mirrors `customer_action.ts`.
 */

import { type Infer, v } from 'convex/values';

import { internal } from '../../../_generated/api';
import { toId } from '../../../lib/type_cast_helpers';
import { vendorAddressValidator } from '../../../vendors/validators';
import type { ActionDefinition } from '../../helpers/nodes/action/types';

// Derived from the shared validator so the param type can never drift from the
// shape the `parametersValidator` actually accepts.
type VendorAddress = Infer<typeof vendorAddressValidator>;

type VendorActionParams =
  | {
      operation: 'create';
      name?: string;
      email?: string;
      phone?: string;
      locale?: string;
      address?: VendorAddress;
      tags?: string[];
      notes?: string;
    }
  | {
      operation: 'update';
      vendorId: string;
      name?: string;
      email?: string;
      phone?: string;
      locale?: string;
      address?: VendorAddress;
      tags?: string[];
      notes?: string;
    }
  | {
      operation: 'get';
      vendorId: string;
    }
  | {
      operation: 'query';
      paginationOpts: { numItems: number; cursor: string | null };
      locale?: string;
    };

export const vendorAction: ActionDefinition<VendorActionParams> = {
  type: 'vendor',
  title: 'Vendor Operation',
  description:
    'Execute vendor/supplier operations (create, update, get, query). organizationId is read from workflow context variables.',
  parametersValidator: v.union(
    v.object({
      operation: v.literal('create'),
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      locale: v.optional(v.string()),
      address: v.optional(vendorAddressValidator),
      tags: v.optional(v.array(v.string())),
      notes: v.optional(v.string()),
    }),
    v.object({
      operation: v.literal('update'),
      vendorId: v.id('vendors'),
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      locale: v.optional(v.string()),
      address: v.optional(vendorAddressValidator),
      tags: v.optional(v.array(v.string())),
      notes: v.optional(v.string()),
    }),
    v.object({
      operation: v.literal('get'),
      vendorId: v.id('vendors'),
    }),
    v.object({
      operation: v.literal('query'),
      paginationOpts: v.object({
        numItems: v.number(),
        cursor: v.union(v.string(), v.null()),
      }),
      locale: v.optional(v.string()),
    }),
  ),
  async execute(ctx, params, variables) {
    const organizationId = variables.organizationId;
    if (typeof organizationId !== 'string') {
      throw new Error(
        'vendor action requires a string organizationId in workflow context',
      );
    }

    switch (params.operation) {
      case 'create': {
        const vendorId = await ctx.runMutation(
          internal.vendors.internal_mutations.createVendor,
          {
            organizationId,
            name: params.name,
            email: params.email,
            phone: params.phone,
            source: 'manual_import',
            locale: params.locale,
            address: params.address,
            tags: params.tags,
            notes: params.notes,
          },
        );
        const vendor = await ctx.runQuery(
          internal.vendors.internal_queries.getVendor,
          { vendorId, callerOrgId: organizationId },
        );
        return { operation: 'create', vendor };
      }

      case 'update': {
        await ctx.runMutation(
          internal.vendors.internal_mutations.updateVendor,
          {
            vendorId: toId<'vendors'>(params.vendorId),
            name: params.name,
            email: params.email,
            phone: params.phone,
            locale: params.locale,
            address: params.address,
            tags: params.tags,
            notes: params.notes,
            callerOrgId: organizationId,
          },
        );
        const vendor = await ctx.runQuery(
          internal.vendors.internal_queries.getVendor,
          {
            vendorId: toId<'vendors'>(params.vendorId),
            callerOrgId: organizationId,
          },
        );
        return { operation: 'update', vendor };
      }

      case 'get': {
        const vendor = await ctx.runQuery(
          internal.vendors.internal_queries.getVendor,
          {
            vendorId: toId<'vendors'>(params.vendorId),
            callerOrgId: organizationId,
          },
        );
        return { operation: 'get', vendor };
      }

      case 'query': {
        const result = await ctx.runQuery(
          internal.vendors.internal_queries.queryVendors,
          {
            organizationId,
            locale: params.locale,
            paginationOpts: params.paginationOpts,
          },
        );
        return { operation: 'query', ...result };
      }

      default: {
        const unhandled: never = params;
        throw new Error(
          `Unsupported vendor operation: ${JSON.stringify(unhandled)}`,
        );
      }
    }
  },
};
