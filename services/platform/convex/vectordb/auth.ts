'use node';

/**
 * Auth gate for the per-organization vector-database actions.
 *
 * The vector-database config is per-org — it selects that organization's
 * retrieval backend and data location. Editing it is gated on the
 * `orgSettings` capability (owner/admin), stricter than the
 * `developerSettings` gate used for providers. The caller authenticates
 * through their membership in `organizationId`; the resolved actor feeds the
 * audit log.
 */

import { ConvexError } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import type { ActionCtx } from '../_generated/server';
import {
  type ProviderActionAuth,
  requireOrgMembershipById,
} from '../providers/auth';

export type OrgSettingsAuth = ProviderActionAuth;

/**
 * Authenticate the caller, verify membership in `organizationId`, and require
 * the `orgSettings` capability (owner/admin). Throws `FORBIDDEN_ORG_SETTINGS`
 * for roles that lack it (developer, editor, member) so action-layer auth
 * matches the route-layer `orgSettings` gate (defense in depth).
 */
export async function requireOrgSettingsAccessById(
  ctx: ActionCtx,
  organizationId: string,
): Promise<OrgSettingsAuth> {
  const auth = await requireOrgMembershipById(ctx, organizationId);
  const ability = defineAbilityFor(auth.member.role);
  if (ability.cannot('read', 'orgSettings')) {
    throw new ConvexError({
      code: 'FORBIDDEN_ORG_SETTINGS',
      message:
        `Role "${auth.member.role}" lacks the organization-settings access ` +
        "required to modify this organization's vector-database configuration.",
    });
  }
  return auth;
}
