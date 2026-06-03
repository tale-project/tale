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
 * Writes additionally require the opt-in `TALE_DEPLOYMENT_CONFIG_UI` flag; the
 * read path is gated only by instance-admin (so an admin can VIEW the current
 * config read-only even when editing is disabled).
 */

import { ConvexError } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import { components } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { authComponent } from '../auth';

/** Normalized read of the opt-in UI/edit flag. */
export function isDeploymentConfigUiEnabled(): boolean {
  const v = (process.env.TALE_DEPLOYMENT_CONFIG_UI ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export interface InstanceAdminAuth {
  userId: string;
  email?: string;
  /** An org the caller administers — used for audit-log actor/org attribution. */
  organizationId: string;
  /** The caller's role in that org (audit attribution). */
  role: string;
}

/**
 * Authenticate the caller and require organization-settings access (owner or
 * admin of some org — the deployment is typically single-org self-hosted, so
 * this is effectively "instance administrator"). When `options.write` is set,
 * also require the opt-in `TALE_DEPLOYMENT_CONFIG_UI` flag, which is the real
 * instance-level gate (the operator enables it at the host).
 *
 * Throws `ConvexError` with a stable `code`:
 * - `UNAUTHENTICATED` — no auth user.
 * - `FORBIDDEN_INSTANCE_ADMIN` — caller administers no organization.
 * - `DEPLOYMENT_CONFIG_UI_DISABLED` — write attempted while the flag is off.
 */
export async function requireInstanceAdmin(
  ctx: ActionCtx,
  options: { write?: boolean } = {},
): Promise<InstanceAdminAuth> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throw new ConvexError({
      code: 'UNAUTHENTICATED',
      message: 'Authentication required.',
    });
  }
  const userId = String(authUser._id);

  const memberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: { cursor: null, numItems: 50 },
    where: [{ field: 'userId', value: userId, operator: 'eq' }],
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter findMany returns paginated unknown
  const members =
    (memberRes as { page?: { organizationId: string; role: string }[] })
      ?.page ?? [];
  const adminMember = members.find((m) =>
    defineAbilityFor(m.role).can('read', 'orgSettings'),
  );
  if (!adminMember) {
    throw new ConvexError({
      code: 'FORBIDDEN_INSTANCE_ADMIN',
      message:
        'Deployment configuration is restricted to organization administrators (instance administrators).',
    });
  }

  if (options.write && !isDeploymentConfigUiEnabled()) {
    throw new ConvexError({
      code: 'DEPLOYMENT_CONFIG_UI_DISABLED',
      message:
        'Editing deployment configuration in the UI is disabled. Set TALE_DEPLOYMENT_CONFIG_UI=true to enable it.',
    });
  }

  return {
    userId,
    email: authUser.email,
    organizationId: adminMember.organizationId,
    role: adminMember.role,
  };
}
