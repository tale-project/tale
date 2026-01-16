/**
 * Common Convex validators shared across multiple models
 * Re-exports shared Zod schemas and generates Convex validators from them
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
	sortOrderSchema,
	prioritySchema,
	dataSourceSchema,
} from '../../../lib/shared/validators/common';

export * from '../../../lib/shared/validators/common';

export const sortOrderValidator = zodToConvex(sortOrderSchema);
export const priorityValidator = zodToConvex(prioritySchema);
export const dataSourceValidator = zodToConvex(dataSourceSchema);
