/**
 * Higher-order function to wrap queries with RLS
 */

import type { QueryCtx, MutationCtx } from '../../../_generated/server';
import type { OrgRole } from '../organization/validate_organization_access';
import type { RLSContext } from '../types';

import { validateOrganizationAccess } from '../organization/validate_organization_access';

/**
 * Higher-order function to wrap queries with RLS
 */
export function withOrganizationRLS<
  TArgs extends { organizationId: string },
  TReturn,
>(
  handler: (
    ctx: QueryCtx | MutationCtx,
    args: TArgs,
    rlsContext: RLSContext,
  ) => Promise<TReturn>,
  allowedRoles?: readonly OrgRole[],
) {
  return async (ctx: QueryCtx | MutationCtx, args: TArgs): Promise<TReturn> => {
    const rlsContext = await validateOrganizationAccess(
      ctx,
      args.organizationId,
      allowedRoles,
    );
    return handler(ctx, args, rlsContext);
  };
}
