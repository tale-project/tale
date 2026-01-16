/**
 * Convex validators for organizations
 * Re-exports shared Zod schemas and generates Convex validators from them
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
	memberRoleSchema,
	organizationSchema,
} from '../../../lib/shared/validators/organizations';

export * from '../common/validators';
export * from '../../../lib/shared/validators/organizations';

export const memberRoleValidator = zodToConvex(memberRoleSchema);
export const organizationValidator = zodToConvex(organizationSchema);
