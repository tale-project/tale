/**
 * Convex validators for organization operations
 */

import { v } from 'convex/values';

import { jsonRecordValidator } from '../lib/validators/json';

export type {
  MemberRole,
  Organization,
} from '../../lib/shared/schemas/organizations';

// Intentionally duplicated in members/validators.ts to keep module bundles independent.
// Do not consolidate — cross-module imports risk pulling transitive deps into query bundles.
export const memberRoleValidator = v.union(
  v.literal('disabled'),
  v.literal('member'),
  v.literal('editor'),
  v.literal('developer'),
  v.literal('admin'),
);

export const organizationValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  name: v.string(),
  slug: v.optional(v.string()),
  logoId: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
});
