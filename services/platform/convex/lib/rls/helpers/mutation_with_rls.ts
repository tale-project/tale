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

import type { DataModel } from '../../../_generated/dataModel';
import { mutation, type MutationCtx } from '../../../_generated/server';
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
 * Custom mutation with RLS enforcement
 * Use this instead of the standard `mutation` function
 */
export const mutationWithRLS = customMutation(
  mutation,
  customCtx(async (ctx: MutationCtx) => {
    // Resolve identity/orgs/teams once per request (memoized; see
    // getRequestAuthContext). JWT identity is 0 DB and org/team lookups run in
    // parallel, so the wrapper adds no redundant cross-component round-trips.
    const { user, userOrganizations, userTeamIds } =
      await getRequestAuthContext(ctx);

    const rules = await rlsRules(ctx, { user, userOrganizations, userTeamIds });

    return {
      db: wrapDatabaseWriter<
        { user: typeof user; userOrganizations: typeof userOrganizations },
        DataModel
      >({ user, userOrganizations }, ctx.db, rules, rlsConfig),
    };
  }),
);
