/**
 * Update user password - Business logic
 */

import { hashPassword } from 'better-auth/crypto';

import {
  isPasswordValid,
  passwordPolicyViolations,
} from '../../lib/shared/schemas/password';
import { getString, isRecord } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
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
  const trigger = args.trigger ?? 'voluntary';

  if (hasPassword && trigger === 'forced') {
    const currentSession = await auth.api.getSession({ headers });
    const sessionObj: unknown = currentSession?.session;
    const currentSessionId = isRecord(sessionObj)
      ? getString(sessionObj, '_id')
      : undefined;
    await forcedResetCredentialPassword(
      ctx,
      String(authUser._id),
      args.newPassword,
      currentSessionId,
    );
  } else if (hasPassword) {
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

async function forcedResetCredentialPassword(
  ctx: MutationCtx,
  userId: string,
  newPassword: string,
  preserveSessionId: string | undefined,
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
    throw new Error('Credential account not found');
  }
  const credentialId = getString(credential, '_id');
  if (!credentialId) {
    throw new Error('Credential account missing _id');
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

  // Revoke every OTHER session for this user, preserving the current
  // one so the caller stays authenticated after the forced rotation
  // (matches Better Auth's `revokeOtherSessions: true` semantics).
  const SESSION_BATCH_SIZE = 100;
  let cursor: string | null = null;
  while (true) {
    const page: { page: unknown[]; isDone: boolean; continueCursor: string } =
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'session',
        paginationOpts: { cursor, numItems: SESSION_BATCH_SIZE },
        where: [{ field: 'userId', value: userId, operator: 'eq' }],
      });
    for (const row of page.page) {
      if (!isRecord(row)) continue;
      const sid = getString(row, '_id');
      if (!sid || sid === preserveSessionId) continue;
      await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: {
          model: 'session',
          where: [{ field: '_id', value: sid, operator: 'eq' }],
        },
        paginationOpts: { cursor: null, numItems: 1 },
      });
    }
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
}
