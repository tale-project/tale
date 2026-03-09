/**
 * Convex validators for members operations
 *
 * All validators use native Convex v.* to avoid bundling zod into query files.
 */

import { v } from 'convex/values';

import { jsonRecordValidator } from '../lib/validators/json';

// Intentionally duplicated in organizations/validators.ts to keep module bundles independent.
// Do not consolidate — cross-module imports risk pulling transitive deps into query bundles.
export const memberRoleValidator = v.union(
  v.literal('disabled'),
  v.literal('member'),
  v.literal('editor'),
  v.literal('developer'),
  v.literal('admin'),
);

export const memberValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  identityId: v.optional(v.string()),
  email: v.optional(v.string()),
  role: v.optional(memberRoleValidator),
  displayName: v.optional(v.string()),
});

export const memberContextValidator = v.object({
  member: v.union(memberValidator, v.null()),
  role: v.union(memberRoleValidator, v.null()),
  isAdmin: v.boolean(),
  canManageMembers: v.boolean(),
  canChangePassword: v.boolean(),
});

export const addMemberResponseValidator = v.object({
  memberId: v.string(),
});

export const memberListItemValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  identityId: v.optional(v.string()),
  email: v.optional(v.string()),
  role: v.optional(memberRoleValidator),
  displayName: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
});
