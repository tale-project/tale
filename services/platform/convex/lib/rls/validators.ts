/**
 * Common validators for RLS-enabled functions
 * Updated to use Better Auth's string-based organization IDs
 */

import { v } from 'convex/values';

/**
 * Validator for organization ID arguments (Better Auth uses string IDs)
 */
export const organizationIdArg = v.string();

/**
 * Common validators for RLS-enabled functions
 */
export const rlsValidators = {
  organizationId: organizationIdArg,
  withPagination: {
    organizationId: organizationIdArg,
    page: v.optional(v.number()),
    size: v.optional(v.number()),
  },
  withSearch: {
    organizationId: organizationIdArg,
    query: v.optional(v.string()),
  },
};
