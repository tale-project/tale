/**
 * Convex validators for members model
 */

import { v } from 'convex/values';

/**
 * Sort order validator
 */
export const sortOrderValidator = v.union(v.literal('asc'), v.literal('desc'));

/**
 * Member list item validator (for listing organization members)
 */
export const memberListItemValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  identityId: v.optional(v.string()),
  email: v.optional(v.string()),
  role: v.optional(v.string()),
  displayName: v.optional(v.string()),
  metadata: v.optional(v.any()),
});

/**
 * Member object validator (for member details)
 */
export const memberValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  identityId: v.optional(v.string()),
  email: v.optional(v.string()),
  role: v.optional(v.string()),
  displayName: v.optional(v.string()),
});

/**
 * Member context response validator (for getCurrentMemberContext)
 */
export const memberContextValidator = v.object({
  member: v.union(memberValidator, v.null()),
  role: v.union(v.string(), v.null()),
  isAdmin: v.boolean(),
  canManageMembers: v.boolean(),
  canChangePassword: v.boolean(),
});

/**
 * Add member response validator
 */
export const addMemberResponseValidator = v.object({
  memberId: v.string(),
});
