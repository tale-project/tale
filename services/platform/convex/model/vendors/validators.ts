/**
 * Convex validators for vendors model
 * Re-exports shared Zod schemas and generates Convex validators from them
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
} from '../../../lib/shared/validators/vendors';

export * from '../common/validators';
export * from '../../../lib/shared/validators/vendors';

export const vendorSourceValidator = zodToConvex(vendorSourceSchema);
export const vendorAddressValidator = zodToConvex(vendorAddressSchema);
export const vendorItemValidator = zodToConvex(vendorItemSchema);
export const vendorInputValidator = zodToConvex(vendorInputSchema);
export const vendorListResponseValidator = zodToConvex(vendorListResponseSchema);
export const bulkCreateErrorItemValidator = zodToConvex(bulkCreateErrorItemSchema);
export const bulkCreateVendorsResponseValidator = zodToConvex(bulkCreateVendorsResponseSchema);
