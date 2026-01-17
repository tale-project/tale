/**
 * Convex validators for customer operations
 *
 * Note: Some schemas use jsonRecordSchema which contains z.lazy() for recursive types.
 * zodToConvex doesn't support z.lazy(), so complex validators are defined with native Convex v.
 */

import { v } from 'convex/values';
import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  customerStatusSchema,
  customerSourceSchema,
  customerAddressSchema,
} from '../../lib/shared/schemas/customers';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export {
  customerStatusSchema,
  customerSourceSchema,
  customerAddressSchema,
  customerSchema,
} from '../../lib/shared/schemas/customers';

// Simple schemas without z.lazy()
export const customerStatusValidator = zodToConvex(customerStatusSchema);
export const customerSourceValidator = zodToConvex(customerSourceSchema);
export const customerAddressValidator = zodToConvex(customerAddressSchema);

// Complex schema with jsonRecordSchema (contains z.lazy) - use native Convex v
export const customerValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  externalId: v.optional(v.union(v.string(), v.number())),
  status: v.optional(customerStatusValidator),
  source: customerSourceValidator,
  locale: v.optional(v.string()),
  address: v.optional(customerAddressValidator),
  metadata: v.optional(jsonRecordValidator),
});
