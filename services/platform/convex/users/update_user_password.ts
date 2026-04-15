/**
 * Update user password - Business logic
 */

import {
  isPasswordValid,
  passwordPolicyViolations,
} from '../../lib/shared/schemas/password';
import { MutationCtx } from '../_generated/server';
import { hasCredentialAccount } from '../accounts/helpers';
import { createAuditLog } from '../audit_logs/helpers';
import { createAuth, authComponent } from '../auth';
import { getStrictestPasswordPolicyForUser } from '../governance/helpers';
import { getUserOrganizations } from '../lib/rls/organization/get_user_organizations';
import { recordPasswordChange } from './password_metadata';

export interface UpdateUserPasswordArgs {
  currentPassword?: string;
  newPassword: string;
  trigger?: 'voluntary' | 'forced';
}

/**
 * Update the current user's password.
 * For credential users: requires currentPassword, uses changePassword.
 * For OAuth-only users: uses setPassword to add a password to their account.
 */
export async function updateUserPassword(
  ctx: MutationCtx,
  args: UpdateUserPasswordArgs,
): Promise<void> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throw new Error('Unauthenticated');
  }
  const { auth, headers } = await authComponent.getAuth(createAuth, ctx);

  const orgs = await getUserOrganizations(ctx, {
    userId: String(authUser._id),
    email: authUser.email,
    name: authUser.name,
  });
  const { policy } = await getStrictestPasswordPolicyForUser(
    ctx,
    orgs.map((o) => o.organizationId),
  );

  if (!isPasswordValid(args.newPassword, policy)) {
    const violations = passwordPolicyViolations(args.newPassword, policy);
    throw new Error(
      `Password does not meet policy (failed: ${violations.join(', ')})`,
    );
  }

  const hasPassword = await hasCredentialAccount(ctx);

  if (hasPassword) {
    if (!args.currentPassword) {
      throw new Error('Current password is required');
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

  await recordPasswordChange(ctx, String(authUser._id));

  const trigger = args.trigger ?? 'voluntary';
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
        actorId: String(authUser._id),
        actorEmail: authUser.email,
        actorType: 'user',
        action: 'user_password.changed',
        category: 'auth',
        resourceType: 'user',
        resourceId: String(authUser._id),
        status: 'success',
        metadata: { trigger },
      }),
    ),
  );
}
