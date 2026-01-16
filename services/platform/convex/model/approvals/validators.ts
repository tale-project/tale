/**
 * Convex validators for approval operations
 * Re-exports shared Zod schemas and generates Convex validators from them
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
	approvalStatusSchema,
	approvalPrioritySchema,
	approvalResourceTypeSchema,
	approvalItemSchema,
} from '../../../lib/shared/validators/approvals';

export * from '../common/validators';
export * from '../../../lib/shared/validators/approvals';

export const approvalStatusValidator = zodToConvex(approvalStatusSchema);
export const approvalPriorityValidator = zodToConvex(approvalPrioritySchema);
export const approvalResourceTypeValidator = zodToConvex(approvalResourceTypeSchema);
export const approvalItemValidator = zodToConvex(approvalItemSchema);
