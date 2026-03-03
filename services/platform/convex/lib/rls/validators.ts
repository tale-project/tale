/**
 * Common validators for RLS-enabled functions
 *
 * Uses native Convex v.* validators to avoid pulling zod into the query bundle.
 * Zod schemas for client-side validation live in lib/shared/schemas/rls.ts.
 */

import { v } from 'convex/values';

export const organizationIdArg = v.string();

export const rlsValidators = {
  organizationId: organizationIdArg,
  withPagination: v.object({
    organizationId: v.string(),
    page: v.optional(v.number()),
    size: v.optional(v.number()),
  }),
  withSearch: v.object({
    organizationId: v.string(),
    query: v.optional(v.string()),
  }),
};
