/**
 * Stricter variant of {@link requireOrgMembershipById} that additionally
 * requires the caller to hold an admin/owner role in Better Auth. Used to
 * gate skill creation, editing, and deletion — the dangerous operations
 * that should not be available to plain members.
 *
 * Developer role: Better Auth supports a `developer` literal but the
 * platform does not currently provision one. The helper is named with
 * "developer" forward-compatibly so future role expansion lands here
 * without a rename. For v1 the effective allowlist is `{owner, admin}`.
 *
 * NOTE: this file is intentionally NOT `'use node'` — it does only V8 work
 * (ctx.runQuery against Better Auth), so it can be imported from both Node
 * and V8 actions.
 */

import { ConvexError } from 'convex/values';

import type { ActionCtx } from '../../_generated/server';
import {
  requireOrgMembershipById,
  type OrgMembershipAuth,
} from './require_org_membership';

const ADMIN_DEVELOPER_ROLES = new Set(['owner', 'admin', 'developer']);

export async function requireOrgAdminOrDeveloper(
  ctx: ActionCtx,
  organizationId: string,
): Promise<OrgMembershipAuth> {
  const auth = await requireOrgMembershipById(ctx, organizationId);
  if (!ADMIN_DEVELOPER_ROLES.has(auth.member.role)) {
    throw new ConvexError({
      code: 'ORG_FORBIDDEN',
      message:
        'This action requires admin, owner, or developer role on the organization.',
    });
  }
  return auth;
}
