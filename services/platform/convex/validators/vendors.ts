/**
 * Convex validators for vendors model
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  vendorSourceSchema,
  vendorAddressSchema,
  vendorItemSchema,
  vendorInputSchema,
  vendorListResponseSchema,
  bulkCreateErrorItemSchema,
  bulkCreateVendorsResponseSchema,
} from '../../lib/shared/schemas/vendors';

export const vendorSourceValidator = zodToConvex(vendorSourceSchema);
export const vendorAddressValidator = zodToConvex(vendorAddressSchema);
export const vendorItemValidator = zodToConvex(vendorItemSchema);
export const vendorInputValidator = zodToConvex(vendorInputSchema);
export const vendorListResponseValidator = zodToConvex(vendorListResponseSchema);
export const bulkCreateErrorItemValidator = zodToConvex(bulkCreateErrorItemSchema);
export const bulkCreateVendorsResponseValidator = zodToConvex(bulkCreateVendorsResponseSchema);
