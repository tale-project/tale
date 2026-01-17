/**
 * Common Convex validators shared across multiple models
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  sortOrderSchema,
  prioritySchema,
  dataSourceSchema,
} from '../../lib/shared/schemas/common';

export const sortOrderValidator = zodToConvex(sortOrderSchema);
export const priorityValidator = zodToConvex(prioritySchema);
export const dataSourceValidator = zodToConvex(dataSourceSchema);
