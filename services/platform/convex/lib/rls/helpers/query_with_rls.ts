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
    // Resolve the caller's identity and organizations once per request (JWT
    // identity is 0 DB; the org lookup is memoized so any handler that
    // re-derives it reuses this computation). Team IDs are resolved lazily
    // inside rlsRules — only the few team-scoped tables need them.
    const { user, userOrganizations } = await getRequestAuthContext(ctx);

    const rules = await rlsRules(ctx, { user, userOrganizations });

    return {
      db: wrapDatabaseReader<
        { user: typeof user; userOrganizations: typeof userOrganizations },
        DataModel
      >({ user, userOrganizations }, ctx.db, rules, rlsConfig),
    };
  }),
);
