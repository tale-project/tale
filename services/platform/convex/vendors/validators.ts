/**
 * Convex validators for vendor operations
 * Generated from shared Zod schemas using zodToConvex
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  vendorSourceSchema,
  vendorAddressSchema,
  vendorItemSchema,
  vendorInputSchema,
  vendorListResponseSchema,
  bulkCreateVendorsResponseSchema,
} from '../../lib/shared/schemas/vendors';

export {
  vendorSourceSchema,
  vendorAddressSchema,
  vendorItemSchema,
  vendorInputSchema,
  vendorListResponseSchema,
  bulkCreateVendorsResponseSchema,
} from '../../lib/shared/schemas/vendors';

export const vendorSourceValidator = zodToConvex(vendorSourceSchema);
export const vendorAddressValidator = zodToConvex(vendorAddressSchema);
export const vendorItemValidator = zodToConvex(vendorItemSchema);
export const vendorInputValidator = zodToConvex(vendorInputSchema);
export const vendorListResponseValidator = zodToConvex(vendorListResponseSchema);
export const bulkCreateVendorsResponseValidator = zodToConvex(bulkCreateVendorsResponseSchema);
