/**
 * Custom mutation with RLS enforcement using convex-helpers
 */

import {
  customCtx,
  customMutation,
} from 'convex-helpers/server/customFunctions';
import {
  wrapDatabaseWriter,
  type RLSConfig,
} from 'convex-helpers/server/rowLevelSecurity';
import { mutation, type MutationCtx } from '../../../_generated/server';
import type { DataModel } from '../../../_generated/dataModel';
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
 * Custom mutation with RLS enforcement
 * Use this instead of the standard `mutation` function
 */
export const mutationWithRLS = customMutation(
  mutation,
  customCtx(async (ctx: MutationCtx) => {
    const rules = await rlsRules(ctx);
    const user = await getAuthenticatedUser(ctx);
    const userOrganizations = user ? await getUserOrganizations(ctx, user) : [];

    return {
      db: wrapDatabaseWriter<{ user: typeof user; userOrganizations: typeof userOrganizations }, DataModel>(
        { user, userOrganizations },
        ctx.db,
        rules,
        rlsConfig,
      ),
    };
  }),
);

