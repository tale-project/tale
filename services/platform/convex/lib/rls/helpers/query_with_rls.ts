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
import { getUserTeamIds } from '../../get_user_teams';
import { getAuthUserIdentity } from '../auth/get_auth_user_identity';
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
    // Use JWT identity (0 DB queries) instead of authComponent.getAuthUser
    // which performs 2 cross-component DB queries (session + user lookup).
    // The JWT is already cryptographically validated by Convex.
    const user = await getAuthUserIdentity(ctx);

    // Fetch organizations and team IDs in parallel to avoid sequential
    // component queries (each calls betterAuth.adapter.findMany)
    const [userOrganizations, userTeamIds] = user
      ? await Promise.all([
          getUserOrganizations(ctx, user),
          getUserTeamIds(ctx, user.userId).then((ids) => new Set(ids)),
        ])
      : [[], new Set<string>()];

    const rules = await rlsRules(ctx, { user, userOrganizations, userTeamIds });

    return {
      db: wrapDatabaseReader<
        { user: typeof user; userOrganizations: typeof userOrganizations },
        DataModel
      >({ user, userOrganizations }, ctx.db, rules, rlsConfig),
    };
  }),
);
