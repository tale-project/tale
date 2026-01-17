/**
 * Convex validators for organizations operations
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import { memberRoleSchema, organizationSchema } from '../../lib/shared/schemas/organizations';

export { memberRoleSchema, organizationSchema } from '../../lib/shared/schemas/organizations';
export type { MemberRole, Organization } from '../../lib/shared/schemas/organizations';

export const memberRoleValidator = zodToConvex(memberRoleSchema);
export const organizationValidator = zodToConvex(organizationSchema);
