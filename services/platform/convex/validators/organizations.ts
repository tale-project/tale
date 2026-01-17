/**
 * Convex validators for organizations
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  memberRoleSchema,
  organizationSchema,
} from '../../lib/shared/schemas/organizations';

export const memberRoleValidator = zodToConvex(memberRoleSchema);
export const organizationValidator = zodToConvex(organizationSchema);
