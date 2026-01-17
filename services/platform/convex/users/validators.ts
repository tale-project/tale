/**
 * Convex validators for users domain
 *
 * Users use Better Auth for storage - no schema table.
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import { roleSchema } from '../../lib/shared/schemas/users';

export const roleValidator = zodToConvex(roleSchema);
