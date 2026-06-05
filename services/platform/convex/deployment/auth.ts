'use node';

/**
 * Deployment-config auth helper (INSTANCE-level, not org-scoped).
 *
 * Deployment config decides where the whole deployment's data physically
 * lives, so it is a higher-privilege action than any per-org setting. There is
 * no dedicated instance-admin role today; for the self-hosted (typically
 * single-org) deployment the org **owner** is the operator, so the v1 gate is:
 * the caller must be an `owner` of at least one organization. A true
 * multi-org `superadmin` role is a future extension.
 *
 * Writes additionally require the caller's email to be in the
 * `TALE_DEPLOYMENT_CONFIG_ADMINS` allowlist; the read path is gated only by
 * instance-admin (so any admin can VIEW the current config read-only even when
 * they are not an editor).
 */

import { ConvexError } from 'convex/values';

import { components } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { decideInstanceAdmin } from './auth_policy';

export interface InstanceAdminAuth {
  userId: string;
  email?: string;
  /** An org the caller administers — used for audit-log actor/org attribution. */
  organizationId: string;
  /** The caller's role in that org (audit attribution). */
  role: string;
}

/** Shape of the Better Auth `member` adapter `findMany` page (returns unknown). */
type MemberPage = { page?: { organizationId: string; role: string }[] };

/**
 * Authenticate the caller and require organization-settings access (owner or
 * admin of some org — the deployment is typically single-org self-hosted, so
 * this is effectively "instance administrator"). When `options.write` is set,
 * also require the caller's email to be in the `TALE_DEPLOYMENT_CONFIG_ADMINS`
 * allowlist — the operator names the editors at the host, so viewing is open to
 * all admins while editing is restricted to the named operators.
 *
 * Throws `ConvexError` with a stable `code`:
 * - `UNAUTHENTICATED` — no auth user.
 * - `FORBIDDEN_INSTANCE_ADMIN` — caller administers no organization.
 * - `FORBIDDEN_DEPLOYMENT_EDITOR` — write attempted by a caller not in the
 *   editor allowlist.
 */
export async function requireInstanceAdmin(
  ctx: ActionCtx,
  options: { write?: boolean } = {},
): Promise<InstanceAdminAuth> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    throw new ConvexError({
      code: 'UNAUTHENTICATED',
      message: 'Authentication required.',
    });
  }
  const userId = authUser.userId;

  const memberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: { cursor: null, numItems: 50 },
    where: [{ field: 'userId', value: userId, operator: 'eq' }],
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter findMany returns paginated unknown
  const members = (memberRes as MemberPage).page ?? [];
  const decision = decideInstanceAdmin({
    email: authUser.email,
    members,
    write: Boolean(options.write),
  });
  if (!decision.ok) {
    throw new ConvexError({
      code: decision.code,
      message:
        decision.code === 'FORBIDDEN_INSTANCE_ADMIN'
          ? 'Deployment configuration is restricted to organization administrators (instance administrators).'
          : 'Your account is not authorized to edit deployment configuration. Ask an ' +
            'operator to add your email to TALE_DEPLOYMENT_CONFIG_ADMINS in the deployment ' +
            '.env, then restart.',
    });
  }

  return {
    userId,
    email: authUser.email,
    organizationId: decision.adminMember.organizationId,
    role: decision.adminMember.role,
  };
}
