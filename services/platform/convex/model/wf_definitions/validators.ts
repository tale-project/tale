/**
 * Convex validators for workflow definitions
 * Re-exports shared Zod schemas and generates Convex validators from them
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
	workflowStatusSchema,
	workflowTypeSchema,
	retryPolicySchema,
	secretConfigSchema,
	workflowConfigSchema,
	workflowUpdateSchema,
} from '../../../lib/shared/validators/wf_definitions';

export * from '../common/validators';
export * from '../../../lib/shared/validators/wf_definitions';

export const workflowStatusValidator = zodToConvex(workflowStatusSchema);
export const workflowTypeValidator = zodToConvex(workflowTypeSchema);
export const retryPolicyValidator = zodToConvex(retryPolicySchema);
export const secretConfigValidator = zodToConvex(secretConfigSchema);
export const workflowConfigValidator = zodToConvex(workflowConfigSchema);
export const workflowUpdateValidator = zodToConvex(workflowUpdateSchema);
