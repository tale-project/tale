/**
 * Update user password - Business logic
 */

import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { ConvexError } from 'convex/values';

import {
  isPasswordValid,
  passwordPolicyViolations,
} from '../../lib/shared/schemas/password';
import { getString, isRecord } from '../../lib/utils/type-utils';
import { components } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import { hasCredentialAccount } from '../accounts/helpers';
import { createAuditLog } from '../audit_logs/helpers';
import { createAuth, authComponent } from '../auth';
import { getStrictestPasswordPolicyForUser } from '../governance/helpers';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getUserOrganizations } from '../lib/rls/organization/get_user_organizations';
import { recordPasswordChange } from './password_metadata';

export interface UpdateUserPasswordArgs {
  currentPassword?: string;
  newPassword: string;
  trigger?: 'voluntary' | 'forced';
}

/**
 * Update the current user's password.
 *
 * - Voluntary change, credential user: requires currentPassword, routed
 *   through Better Auth's `changePassword` API (re-authenticates).
 * - Voluntary/forced, OAuth-only user: routed through `setPassword` (no
 *   currentPassword needed — they're adding a password for the first time).
 * - Forced change, credential user: currentPassword is NOT required. The
 *   user already authenticated this session and the rotation flow's
 *   purpose is freshness, not re-authentication. Updates the credential
 *   account directly via the Better Auth adapter and revokes other
 *   sessions to keep the voluntary-flow parity.
 */
export async function updateUserPassword(
  ctx: MutationCtx,
  args: UpdateUserPasswordArgs,
): Promise<void> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    throw new ConvexError({
      code: 'unauthenticated',
      message: 'Unauthenticated',
    });
  }
  const { auth, headers } = await authComponent.getAuth(createAuth, ctx);

  const orgs = await getUserOrganizations(ctx, authUser);
  const { policy } = await getStrictestPasswordPolicyForUser(
    ctx,
    orgs.map((o) => o.organizationId),
  );

  if (!isPasswordValid(args.newPassword, policy)) {
    const violations = passwordPolicyViolations(args.newPassword, policy);
    throw new ConvexError({
      code: 'password_policy_violation',
      message: `Password does not meet policy (failed: ${violations.join(', ')})`,
    });
  }

  const hasPassword = await hasCredentialAccount(ctx);
  const trigger = args.trigger ?? 'voluntary';

  if (hasPassword && trigger === 'forced') {
    await forcedResetCredentialPassword(ctx, authUser.userId, args.newPassword);
    // Revoke every session for this user EXCEPT the caller's current
    // one. Delegating to Better Auth's own API (rather than matching
    // session rows manually) guarantees we use the same identity it
    // uses to decide which session is "current", independent of how
    // the Convex adapter maps ids vs. tokens.
    await auth.api.revokeOtherSessions({ headers });
  } else if (hasPassword) {
    if (!args.currentPassword) {
      throw new ConvexError({
        code: 'current_password_required',
        message: 'Current password is required',
      });
    }
    await auth.api.changePassword({
      body: {
        currentPassword: args.currentPassword,
        newPassword: args.newPassword,
        revokeOtherSessions: true,
      },
      headers,
    });
  } else {
    await auth.api.setPassword({
      body: {
        newPassword: args.newPassword,
      },
      headers,
    });
  }

  await recordPasswordChange(ctx, authUser.userId);

  // Audit the change against every org the user belongs to, so each
  // org's compliance trail records the credential rotation. Fall back
  // to a single log without organizationId-scoped trail only when the
  // user belongs to no orgs (shouldn't happen post-onboarding).
  if (orgs.length === 0) {
    return;
  }
  await Promise.all(
    orgs.map((o) =>
      createAuditLog(ctx, {
        organizationId: o.organizationId,
        actorId: authUser.userId,
        actorEmail: authUser.email,
        actorType: 'user',
        action: 'user_password.changed',
        category: 'auth',
        resourceType: 'user',
        resourceId: authUser.userId,
        status: 'success',
        metadata: { trigger },
      }),
    ),
  );
}

async function forcedResetCredentialPassword(
  ctx: MutationCtx,
  userId: string,
  newPassword: string,
): Promise<void> {
  const accountRes = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'account',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        { field: 'userId', value: userId, operator: 'eq' },
        { field: 'providerId', value: 'credential', operator: 'eq' },
      ],
    },
  );
  const credential = accountRes?.page?.[0];
  if (!isRecord(credential)) {
    throw new ConvexError({
      code: 'credential_account_not_found',
      message: 'Credential account not found',
    });
  }
  const credentialId = getString(credential, '_id');
  if (!credentialId) {
    throw new ConvexError({
      code: 'credential_account_not_found',
      message: 'Credential account missing _id',
    });
  }

  // Rotation hygiene: a forced change must not re-set the very password the
  // user is being forced to rotate away from. The forced path deliberately
  // skips the currentPassword re-auth, so without this check an expired
  // credential can be "rotated" to itself, silently defeating the policy
  // (#2038). The voluntary path is unaffected — Better Auth's changePassword
  // already re-authenticates with the current password.
  const currentHash = getString(credential, 'password');
  if (
    currentHash &&
    (await verifyPassword({ hash: currentHash, password: newPassword }))
  ) {
    throw new ConvexError({
      code: 'password_reused',
      message: 'New password must be different from your current password',
    });
  }

  const passwordHash = await hashPassword(newPassword);
  await ctx.runMutation(components.betterAuth.adapter.updateMany, {
    input: {
      model: 'account',
      where: [{ field: '_id', value: credentialId, operator: 'eq' }],
      update: { password: passwordHash, updatedAt: Date.now() },
    },
    paginationOpts: { cursor: null, numItems: 1 },
  });
}
