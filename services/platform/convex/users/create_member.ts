/**
 * Create member - Business logic
 */

import { ConvexError } from 'convex/values';

import { isRecord, getString } from '../../lib/utils/type-utils';
import { components } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import { createAuth } from '../auth';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { upsertMemberMirror } from '../members/mirror_sync';
import { recordPasswordChange } from './password_metadata';
import type { Role } from './types';

export interface CreateMemberArgs {
  organizationId: string;
  email: string;
  password?: string;
  displayName?: string;
  role?: Role;
}

export interface CreateMemberResult {
  userId: string;
  memberId: string;
  isExistingUser: boolean;
}

/**
 * Create a new user and add them to an organization.
 * Unlike client-side signup, this does NOT create a session, so the admin remains logged in.
 *
 * This function uses Better Auth's API directly to create users with proper password hashing.
 *
 * Architecture:
 * - Better Auth manages authentication and stores user credentials
 * - We store Better Auth's internal user ID (_id) as identityId in our members table
 * - This links our member records to Better Auth users
 */
export async function createMember(
  ctx: MutationCtx,
  args: CreateMemberArgs,
): Promise<CreateMemberResult> {
  // Verify the current user is authenticated and is an admin
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    throw new ConvexError({ code: 'UNAUTHENTICATED' });
  }

  // Check if the current user is an admin/owner of the organization (Better Auth)
  const currentMemberRes = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        { field: 'organizationId', value: args.organizationId, operator: 'eq' },
        { field: 'userId', value: authUser.userId, operator: 'eq' },
      ],
    },
  );
  const currentMemberRaw = currentMemberRes?.page?.[0];
  const currentMemberRec = isRecord(currentMemberRaw)
    ? currentMemberRaw
    : undefined;
  const callerRole = (
    currentMemberRec ? (getString(currentMemberRec, 'role') ?? '') : ''
  ).toLowerCase();
  if (!isAdmin(callerRole)) {
    throw new ConvexError({
      code: 'FORBIDDEN',
      message: 'Only admins can create members',
    });
  }

  // The owner role can only be assigned through the owner-gated
  // transferOwnership flow — never via createMember. Mirror updateMemberRole's
  // rejection so a non-owner admin cannot self-escalate by passing
  // role: 'owner' (see members/mutations.ts updateMemberRole).
  if ((args.role ?? '').toLowerCase() === 'owner') {
    throw new Error('The owner role cannot be assigned manually');
  }

  const email = args.email.toLowerCase().trim();

  // Check if user already exists by querying Better Auth directly
  const existingUserResult = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'user',
      paginationOpts: {
        cursor: null,
        numItems: 1,
      },
      where: [
        {
          field: 'email',
          value: email,
          operator: 'eq',
        },
      ],
    },
  );

  const existingUserRaw = existingUserResult?.page?.[0];
  const existingUserRec = isRecord(existingUserRaw)
    ? existingUserRaw
    : undefined;
  const existingUserId = existingUserRec
    ? getString(existingUserRec, '_id')
    : undefined;

  if (existingUserId) {
    // User exists — check if they're already a member of this organization
    const existingMemberResult = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          {
            field: 'organizationId',
            value: args.organizationId,
            operator: 'eq',
          },
          { field: 'userId', value: existingUserId, operator: 'eq' },
        ],
      },
    );

    if (existingMemberResult && existingMemberResult.page.length > 0) {
      // Surface a structured code so the add-member dialog can show a
      // field-level error on the email input instead of a generic toast.
      throw new ConvexError({
        code: 'DUPLICATE_MEMBER',
        message: 'User is already a member of this organization',
      });
    }

    // Re-add the existing user to the organization
    const existingUserRole = (args.role ?? 'member').toLowerCase();
    const existingUserCreatedAt = Date.now();
    const created = await ctx.runMutation(
      components.betterAuth.adapter.create,
      {
        input: {
          model: 'member',
          data: {
            organizationId: args.organizationId,
            userId: existingUserId,
            role: existingUserRole,
            createdAt: existingUserCreatedAt,
          },
        },
      },
    );
    const createdRec = isRecord(created) ? created : undefined;
    const memberId: string =
      (createdRec ? getString(createdRec, '_id') : undefined) ??
      (createdRec ? getString(createdRec, 'id') : undefined) ??
      String(created);

    await upsertMemberMirror(ctx, {
      memberId,
      userId: existingUserId,
      organizationId: args.organizationId,
      role: existingUserRole,
      createdAt: existingUserCreatedAt,
    });

    return {
      userId: existingUserId,
      memberId,
      isExistingUser: true,
    };
  }

  // User doesn't exist — create a new account. Surface a structured code so
  // the add-member dialog can show a field-level error on the password input
  // instead of a generic "failed" toast (#1470).
  if (!args.password) {
    throw new ConvexError({
      code: 'PASSWORD_REQUIRED',
      message: 'Password is required when creating a new user',
    });
  }

  const auth = createAuth(ctx);

  const signupResult = await auth.api.signUpEmail({
    body: {
      email,
      password: args.password,
      name: args.displayName ?? '',
    },
  });

  if (!signupResult) {
    throw new ConvexError({
      code: 'USER_CREATION_FAILED',
      message: 'Failed to create user account',
    });
  }

  const userResult = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'user',
      paginationOpts: {
        cursor: null,
        numItems: 1,
      },
      where: [
        {
          field: 'email',
          value: email,
          operator: 'eq',
        },
      ],
    },
  );

  if (!userResult || userResult.page.length === 0) {
    throw new ConvexError({
      code: 'USER_CREATION_FAILED',
      message:
        'Failed to retrieve user after signup. ' +
        'The user was created in Better Auth but could not be found. ' +
        'Email: ' +
        email,
    });
  }

  const betterAuthUserId = userResult.page[0]._id;

  const newUserRole = (args.role ?? 'member').toLowerCase();
  const newUserCreatedAt = Date.now();
  const created = await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: 'member',
      data: {
        organizationId: args.organizationId,
        userId: betterAuthUserId,
        role: newUserRole,
        createdAt: newUserCreatedAt,
      },
    },
  });
  const createdRecord = isRecord(created) ? created : undefined;
  const memberId: string =
    (createdRecord ? getString(createdRecord, '_id') : undefined) ??
    (createdRecord ? getString(createdRecord, 'id') : undefined) ??
    String(created);

  await upsertMemberMirror(ctx, {
    memberId,
    userId: betterAuthUserId,
    organizationId: args.organizationId,
    role: newUserRole,
    createdAt: newUserCreatedAt,
  });

  await recordPasswordChange(ctx, betterAuthUserId, {
    forceChangeOnNextLogin: true,
  });

  return {
    userId: betterAuthUserId,
    memberId,
    isExistingUser: false,
  };
}
