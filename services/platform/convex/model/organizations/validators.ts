/**
 * Convex validators for organizations
 */

import { v } from 'convex/values';

/**
 * Organization validator
 */
export const organizationValidator = v.object({
  _id: v.id('organizations'),
  _creationTime: v.number(),
  name: v.string(),
  slug: v.optional(v.string()),
  logoId: v.optional(v.id('_storage')),
  metadata: v.optional(v.any()),
});

/**
 * Member role validator
 */
export const memberRoleValidator = v.union(
  v.literal('Disabled'),
  v.literal('Admin'),
  v.literal('Developer'),
  v.literal('Editor'),
  v.literal('Member'),
);
