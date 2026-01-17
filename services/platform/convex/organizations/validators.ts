/**
 * Convex validators for organizations operations
 *
 * Note: Some schemas use jsonRecordSchema which contains z.lazy() for recursive types.
 * zodToConvex doesn't support z.lazy(), so complex validators are defined with native Convex v.
 */

import { v } from 'convex/values';
import { zodToConvex } from 'convex-helpers/server/zod3';
import { memberRoleSchema } from '../../lib/shared/schemas/organizations';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export { memberRoleSchema, organizationSchema } from '../../lib/shared/schemas/organizations';
export type { MemberRole, Organization } from '../../lib/shared/schemas/organizations';

// Simple schemas without z.lazy()
export const memberRoleValidator = zodToConvex(memberRoleSchema);

// Complex schemas with jsonRecordSchema (contains z.lazy) - use native Convex v
export const organizationValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  name: v.string(),
  slug: v.optional(v.string()),
  logoId: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
});
