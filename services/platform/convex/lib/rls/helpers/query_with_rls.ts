/**
 * Custom query with RLS enforcement using convex-helpers
 */

import { customCtx, customQuery } from 'convex-helpers/server/customFunctions';
import {
  wrapDatabaseReader,
  type RLSConfig,
} from 'convex-helpers/server/rowLevelSecurity';

import type { DataModel } from '../../../_generated/dataModel';
import { query, type QueryCtx } from '../../../_generated/server';
import { getRequestAuthContext } from '../context/request_auth_cache';
import { rlsRules } from './rls_rules';

/**
 * RLS Configuration
 * By default, deny access to tables not explicitly listed in rules
 */
const rlsConfig: RLSConfig = {
  defaultPolicy: 'deny',
};

/**
 * Custom query with RLS enforcement
 * Use this instead of the standard `query` function
 */
export const queryWithRLS = customQuery(
  query,
  customCtx(async (ctx: QueryCtx) => {
    // Resolve the caller's identity, organizations and team IDs once per
    // request (JWT identity is 0 DB; org/team lookups run in parallel and are
    // memoized so any handler that re-derives them reuses this computation).
    const { user, userOrganizations, userTeamIds } =
      await getRequestAuthContext(ctx);

    const rules = await rlsRules(ctx, { user, userOrganizations, userTeamIds });

    return {
      db: wrapDatabaseReader<
        { user: typeof user; userOrganizations: typeof userOrganizations },
        DataModel
      >({ user, userOrganizations }, ctx.db, rules, rlsConfig),
    };
  }),
);
