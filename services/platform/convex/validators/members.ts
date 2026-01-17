/**
 * Convex validators for members model
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  memberListItemSchema,
  memberSchema,
  memberContextSchema,
  addMemberResponseSchema,
} from '../../lib/shared/schemas/members';

export const memberListItemValidator = zodToConvex(memberListItemSchema);
export const memberValidator = zodToConvex(memberSchema);
export const memberContextValidator = zodToConvex(memberContextSchema);
export const addMemberResponseValidator = zodToConvex(addMemberResponseSchema);
