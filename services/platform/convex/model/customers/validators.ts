/**
 * Convex validators for customer operations
 * Re-exports shared Zod schemas and generates Convex validators from them
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
	customerStatusSchema,
	customerSourceSchema,
	customerAddressSchema,
	customerSchema,
} from '../../../lib/shared/validators/customers';

export * from '../common/validators';
export * from '../../../lib/shared/validators/customers';

export const customerStatusValidator = zodToConvex(customerStatusSchema);
export const customerSourceValidator = zodToConvex(customerSourceSchema);
export const customerAddressValidator = zodToConvex(customerAddressSchema);
export const customerValidator = zodToConvex(customerSchema);
