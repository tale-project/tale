/**
 * Convex validators for website operations
 * Re-exports shared Zod schemas and generates Convex validators from them
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
	websiteStatusSchema,
	websiteSchema,
	websitePageSchema,
} from '../../../lib/shared/validators/websites';

export * from '../common/validators';
export * from '../../../lib/shared/validators/websites';

export const websiteStatusValidator = zodToConvex(websiteStatusSchema);
export const websiteValidator = zodToConvex(websiteSchema);
export const websitePageValidator = zodToConvex(websitePageSchema);
