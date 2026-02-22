/**
 * Custom mutation with RLS enforcement using convex-helpers/zod4
 * Allows using Zod schemas for argument validation
 */

import { customCtx } from 'convex-helpers/server/customFunctions';
import {
  wrapDatabaseWriter,
  type RLSConfig,
} from 'convex-helpers/server/rowLevelSecurity';
import { zCustomMutation } from 'convex-helpers/server/zod4';

import type { DataModel } from '../../../_generated/dataModel';

import { mutation, type MutationCtx } from '../../../_generated/server';
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
 * Custom mutation with RLS enforcement using Zod validation
 * Use this instead of the standard `mutationWithRLS` when you want to use Zod schemas
 *
 * Example:
 * ```ts
 * import { z } from 'zod/v4';
 * import { zMutationWithRLS } from './z_mutation_with_rls';
 *
 * export const updateProduct = zMutationWithRLS({
 *   args: {
 *     productId: z.string(),
 *     name: z.string().min(1),
 *     status: z.enum(['active', 'inactive']),
 *   },
 *   handler: async (ctx, args) => {
 *     // ctx.db is wrapped with RLS
 *     await ctx.db.patch(args.productId, { name: args.name, status: args.status });
 *   },
 * });
 * ```
 */
export const zMutationWithRLS = zCustomMutation(
  mutation,
  customCtx(async (ctx: MutationCtx) => {
    const user = await getAuthUserIdentity(ctx);

    const [userOrganizations, userTeamIds] = user
      ? await Promise.all([
          getUserOrganizations(ctx, user),
          getUserTeamIds(ctx, user.userId).then((ids) => new Set(ids)),
        ])
      : [[], new Set<string>()];

    const rules = await rlsRules(ctx, { user, userOrganizations, userTeamIds });

    return {
      db: wrapDatabaseWriter<
        { user: typeof user; userOrganizations: typeof userOrganizations },
        DataModel
      >({ user, userOrganizations }, ctx.db, rules, rlsConfig),
    };
  }),
);
