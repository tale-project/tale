/**
 * Convex validators for approval operations
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  approvalStatusSchema,
  approvalPrioritySchema,
  approvalResourceTypeSchema,
  approvalItemSchema,
} from '../../lib/shared/schemas/approvals';

export const approvalStatusValidator = zodToConvex(approvalStatusSchema);
export const approvalPriorityValidator = zodToConvex(approvalPrioritySchema);
export const approvalResourceTypeValidator = zodToConvex(approvalResourceTypeSchema);
export const approvalItemValidator = zodToConvex(approvalItemSchema);
