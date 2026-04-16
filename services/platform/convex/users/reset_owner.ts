/**
 * Reset owner credentials - Business logic
 *
 * Resets the owner's email and/or password. Called only via admin-authenticated
 * path (CLI → container script → internalMutation). No session auth check needed.
 *
 * This path intentionally validates the new password against the built-in
 * DEFAULT_PASSWORD_POLICY (not an org-configurable policy). Reason: this
 * is a recovery tool. If an admin locked themselves out by configuring an
 * unreachably strict policy, honoring that policy here would make recovery
 * impossible.
 */

import { hashPassword } from 'better-auth/crypto';

import {
  isPasswordValid,
  passwordPolicyViolations,
} from '../../lib/shared/schemas/password';
import { isRecord, getString } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { MutationCtx } from '../_generated/server';
import { recordPasswordChange } from './password_metadata';

export interface ResetOwnerArgs {
  newEmail?: string;
  newPassword?: string;
}

export interface ResetOwnerResult {
  email: string;
  updated: { email: boolean; password: boolean };
}

export async function resetOwner(
  ctx: MutationCtx,
  args: ResetOwnerArgs,
): Promise<ResetOwnerResult> {
  if (!args.newEmail && !args.newPassword) {
    throw new Error('At least one of newEmail or newPassword is required');
  }

  // Find the owner member
  const memberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: { cursor: null, numItems: 10 },
    where: [{ field: 'role', value: 'owner', operator: 'eq' }],
  });

  const ownerMember = memberRes?.page?.find(
    (m: unknown) =>
      isRecord(m) && getString(m, 'role')?.toLowerCase() === 'owner',
  );
  if (!isRecord(ownerMember)) {
    throw new Error('No owner found in the organization');
  }

  const ownerUserId = getString(ownerMember, 'userId');
  if (!ownerUserId) {
    throw new Error('Owner member missing userId');
  }

  // Look up the owner's user record
  const userRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'user',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [{ field: '_id', value: ownerUserId, operator: 'eq' }],
  });
  const ownerUser = userRes?.page?.[0];
  if (!isRecord(ownerUser)) {
    throw new Error('Owner user record not found');
  }

  let currentEmail = getString(ownerUser, 'email') ?? '';
  let updatedEmail = false;
  let updatedPassword = false;

  // Update email if requested
  if (args.newEmail) {
    // Check email uniqueness
    const existingRes = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'user',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: 'email', value: args.newEmail, operator: 'eq' }],
      },
    );
    const existingUser = existingRes?.page?.[0];
    if (
      isRecord(existingUser) &&
      getString(existingUser, '_id') !== ownerUserId
    ) {
      throw new Error(
        `Email "${args.newEmail}" is already in use by another user`,
      );
    }

    const ownerId = getString(ownerUser, '_id');
    if (!ownerId) throw new Error('Owner user missing _id');

    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'user',
        where: [{ field: '_id', value: ownerId, operator: 'eq' }],
        update: {
          email: args.newEmail,
          updatedAt: Date.now(),
        },
      },
      paginationOpts: { cursor: null, numItems: 1 },
    });
    currentEmail = args.newEmail;
    updatedEmail = true;
  }

  // Update password if requested
  if (args.newPassword) {
    if (!isPasswordValid(args.newPassword)) {
      const violations = passwordPolicyViolations(args.newPassword);
      throw new Error(
        `Password does not meet recovery defaults (failed: ${violations.join(', ')})`,
      );
    }

    const passwordHash = await hashPassword(args.newPassword);

    // Find existing credential account
    const accountRes = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'account',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          { field: 'userId', value: ownerUserId, operator: 'eq' },
          { field: 'providerId', value: 'credential', operator: 'eq' },
        ],
      },
    );
    const existingCredential = accountRes?.page?.[0];

    if (isRecord(existingCredential)) {
      const credentialId = getString(existingCredential, '_id');
      if (!credentialId) throw new Error('Credential account missing _id');

      await ctx.runMutation(components.betterAuth.adapter.updateMany, {
        input: {
          model: 'account',
          where: [{ field: '_id', value: credentialId, operator: 'eq' }],
          update: {
            password: passwordHash,
            updatedAt: Date.now(),
          },
        },
        paginationOpts: { cursor: null, numItems: 1 },
      });
    } else {
      // Create credential account for OAuth-only owner
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: 'account',
          data: {
            userId: ownerUserId,
            providerId: 'credential',
            accountId: ownerUserId,
            password: passwordHash,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      });
    }
    await recordPasswordChange(ctx, ownerUserId);
    updatedPassword = true;
  }

  // Invalidate all sessions for the owner
  const SESSION_BATCH_SIZE = 100;
  let hasMoreSessions = true;
  while (hasMoreSessions) {
    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: {
        model: 'session',
        where: [{ field: 'userId', value: ownerUserId, operator: 'eq' }],
      },
      paginationOpts: { cursor: null, numItems: SESSION_BATCH_SIZE },
    });
    const remaining = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'session',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: 'userId', value: ownerUserId, operator: 'eq' }],
      },
    );
    hasMoreSessions = (remaining?.page?.length ?? 0) > 0;
  }

  return {
    email: currentEmail,
    updated: { email: updatedEmail, password: updatedPassword },
  };
}
