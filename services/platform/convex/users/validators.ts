/**
 * Convex validators for users domain
 *
 * Users use Better Auth for storage - no schema table.
 */

import { v } from 'convex/values';

export const roleValidator = v.union(
  v.literal('owner'),
  v.literal('admin'),
  v.literal('developer'),
  v.literal('editor'),
  v.literal('member'),
  v.literal('disabled'),
);
