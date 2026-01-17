/**
 * Custom query with RLS enforcement using convex-helpers/zod3
 * Allows using Zod schemas for argument validation
 */

import { customCtx } from 'convex-helpers/server/customFunctions';
import {
	wrapDatabaseReader,
	type RLSConfig,
} from 'convex-helpers/server/rowLevelSecurity';
import { zCustomQuery } from 'convex-helpers/server/zod3';
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
 * Custom query with RLS enforcement using Zod validation
 * Use this instead of the standard `queryWithRLS` when you want to use Zod schemas
 *
 * Example:
 * ```ts
 * import { z } from 'zod';
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
