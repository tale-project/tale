/**
 * Convex validators for customer operations
 * Generated from shared Zod schemas using zodToConvex
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  customerStatusSchema,
  customerSourceSchema,
  customerAddressSchema,
  customerSchema,
} from '../../lib/shared/schemas/customers';

export {
  customerStatusSchema,
  customerSourceSchema,
  customerAddressSchema,
  customerSchema,
} from '../../lib/shared/schemas/customers';

export const customerStatusValidator = zodToConvex(customerStatusSchema);
export const customerSourceValidator = zodToConvex(customerSourceSchema);
export const customerAddressValidator = zodToConvex(customerAddressSchema);
export const customerValidator = zodToConvex(customerSchema);
