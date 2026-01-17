/**
 * Convex validators for members operations
 * Generated from shared Zod schemas using zodToConvex
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  memberListItemSchema,
  memberSchema,
  memberContextSchema,
  addMemberResponseSchema,
} from '../../lib/shared/schemas/members';
import { memberRoleSchema } from '../../lib/shared/schemas/organizations';

export {
  memberListItemSchema,
  memberSchema,
  memberContextSchema,
} from '../../lib/shared/schemas/members';

export const memberRoleValidator = zodToConvex(memberRoleSchema);
export const memberListItemValidator = zodToConvex(memberListItemSchema);
export const memberValidator = zodToConvex(memberSchema);
export const memberContextValidator = zodToConvex(memberContextSchema);
export const addMemberResponseValidator = zodToConvex(addMemberResponseSchema);
