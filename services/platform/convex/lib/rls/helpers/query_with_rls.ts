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
import { getAuthenticatedUser } from '../auth/get_authenticated_user';
import { getUserOrganizations } from '../organization/get_user_organizations';
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
    // Fetch auth data ONCE to avoid duplicate queries
    const user = await getAuthenticatedUser(ctx);
    const userOrganizations = user ? await getUserOrganizations(ctx, user) : [];

    // Pass pre-fetched data to rlsRules to avoid duplicate fetches
    const rules = await rlsRules(ctx, { user, userOrganizations });

    return {
      db: wrapDatabaseReader<
        { user: typeof user; userOrganizations: typeof userOrganizations },
        DataModel
      >({ user, userOrganizations }, ctx.db, rules, rlsConfig),
    };
  }),
);
