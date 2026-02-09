/**
 * Convex validators for members operations
 *
 * Note: Some schemas use jsonRecordSchema which contains z.lazy() for recursive types.
 * zodToConvex doesn't support z.lazy(), so complex validators are defined with native Convex v.
 */

import { zodToConvex } from 'convex-helpers/server/zod4';
import { v } from 'convex/values';

import {
  memberSchema,
  memberContextSchema,
  addMemberResponseSchema,
} from '../../lib/shared/schemas/members';
import { memberRoleSchema } from '../../lib/shared/schemas/organizations';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export {
  memberListItemSchema,
  memberSchema,
  memberContextSchema,
} from '../../lib/shared/schemas/members';

// Simple schemas without z.lazy()
export const memberRoleValidator = zodToConvex(memberRoleSchema);
export const memberValidator = zodToConvex(memberSchema);
export const memberContextValidator = zodToConvex(memberContextSchema);
export const addMemberResponseValidator = zodToConvex(addMemberResponseSchema);

// Complex schemas with jsonRecordSchema (contains z.lazy) - use native Convex v
export const memberListItemValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  identityId: v.optional(v.string()),
  email: v.optional(v.string()),
  role: v.optional(v.string()),
  displayName: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
});
