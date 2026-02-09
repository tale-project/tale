/**
 * Higher-order function to wrap mutations with RLS
 */

import type { Id } from '../../../_generated/dataModel';
import type { MutationCtx } from '../../../_generated/server';
import type { OrgRole } from '../organization/validate_organization_access';
import type { RLSContext } from '../types';

import { RLSError } from '../errors';
import { validateOrganizationAccess } from '../organization/validate_organization_access';

/**
 * Higher-order function to wrap mutations with RLS
 */
export function withResourceRLS<
  TArgs extends { resourceId: Id<any> },
  TResource extends { organizationId: string },
  TReturn,
>(
  tableName: string,
  handler: (
    ctx: MutationCtx,
    args: TArgs,
    resource: TResource,
    rlsContext: RLSContext,
  ) => Promise<TReturn>,
  allowedRoles?: readonly OrgRole[],
) {
  return async (ctx: MutationCtx, args: TArgs): Promise<TReturn> => {
    // Get resource first
    const resource = (await ctx.db.get(args.resourceId)) as TResource | null;

    if (!resource) {
      throw new RLSError('Resource not found', 'NOT_FOUND');
    }

    // Validate organization access
    const rlsContext = await validateOrganizationAccess(
      ctx,
      resource.organizationId,
      allowedRoles,
    );

    return handler(ctx, args, resource, rlsContext);
  };
}
