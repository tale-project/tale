/**
 * Custom query with RLS enforcement using convex-helpers
 */

import {
  customCtx,
  customQuery,
} from 'convex-helpers/server/customFunctions';
import {
  wrapDatabaseReader,
  type RLSConfig,
} from 'convex-helpers/server/rowLevelSecurity';
import { query } from '../../../_generated/server';
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
  customCtx(async (ctx) => {
    const rules = await rlsRules(ctx);
    const user = await getAuthenticatedUser(ctx);
    const userOrganizations = user ? await getUserOrganizations(ctx, user) : [];

    return {
      db: wrapDatabaseReader(
        { user, userOrganizations },
        ctx.db,
        rules,
        rlsConfig,
      ),
    };
  }),
);

