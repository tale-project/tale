// Note: jsonRecordSchema contains z.lazy() which zodToConvex doesn't support,
// so validators containing metadata use native Convex v instead.

import { v } from 'convex/values';
import { zodToConvex } from 'convex-helpers/server/zod4';
import { memberRoleSchema } from '../../lib/shared/schemas/organizations';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export { memberRoleSchema, organizationSchema } from '../../lib/shared/schemas/organizations';
export type { MemberRole, Organization } from '../../lib/shared/schemas/organizations';

export const memberRoleValidator = zodToConvex(memberRoleSchema);

export const organizationValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  name: v.string(),
  slug: v.optional(v.string()),
  logoId: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
});
