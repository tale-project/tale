/**
 * Convex validators for website operations
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  websiteStatusSchema,
  websiteSchema,
  websitePageSchema,
} from '../../lib/shared/schemas/websites';

export const websiteStatusValidator = zodToConvex(websiteStatusSchema);
export const websiteValidator = zodToConvex(websiteSchema);
export const websitePageValidator = zodToConvex(websitePageSchema);
