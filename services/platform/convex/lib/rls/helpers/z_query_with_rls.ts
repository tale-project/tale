/**
 * Custom query with RLS enforcement using convex-helpers/zod4
 * Allows using Zod schemas for argument validation
 */

import { customCtx } from 'convex-helpers/server/customFunctions';
import {
  wrapDatabaseReader,
  type RLSConfig,
} from 'convex-helpers/server/rowLevelSecurity';
import { zCustomQuery } from 'convex-helpers/server/zod4';

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
 * Custom query with RLS enforcement using Zod validation
 * Use this instead of the standard `queryWithRLS` when you want to use Zod schemas
 *
 * Example:
 * ```ts
 * import { z } from 'zod/v4';
 * import { zQueryWithRLS } from './z_query_with_rls';
 *
 * export const getProducts = zQueryWithRLS({
 *   args: { organizationId: z.string() },
 *   handler: async (ctx, args) => {
 *     // ctx.db is wrapped with RLS
 *     return await ctx.db.query('products').collect();
 *   },
 * });
 * ```
 */
export const zQueryWithRLS = zCustomQuery(
  query,
  customCtx(async (ctx: QueryCtx) => {
    const user = await getAuthUserIdentity(ctx);

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
