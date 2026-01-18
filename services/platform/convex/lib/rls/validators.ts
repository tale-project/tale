/**
 * Common validators for RLS-enabled functions
 * Re-exports shared Zod schemas and generates Convex validators from them
 */

import { zodToConvex } from 'convex-helpers/server/zod4';
import {
  organizationIdArgSchema,
  rlsWithPaginationArgsSchema,
  rlsWithSearchArgsSchema,
} from '../../../lib/shared/schemas/rls';

export * from '../../../lib/shared/schemas/rls';

export const organizationIdArg = zodToConvex(organizationIdArgSchema);

export const rlsValidators = {
  organizationId: organizationIdArg,
  withPagination: zodToConvex(rlsWithPaginationArgsSchema),
  withSearch: zodToConvex(rlsWithSearchArgsSchema),
};
