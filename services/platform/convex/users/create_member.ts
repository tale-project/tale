/**
 * Create member - Business logic
 */

import type { Role } from './types';

import { isRecord, getString } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { MutationCtx } from '../_generated/server';
import { createAuth, authComponent } from '../auth';

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
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throw new Error('Unauthenticated');
  }

  // Check if the current user is an admin/owner of the organization (Better Auth)
  const currentMemberRes = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        { field: 'organizationId', value: args.organizationId, operator: 'eq' },
        { field: 'userId', value: String(authUser._id), operator: 'eq' },
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
  if (callerRole !== 'admin') {
    throw new Error('Only Admins can create members');
  }

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
          value: args.email,
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
      throw new Error('User is already a member of this organization');
    }

    // Re-add the existing user to the organization
    const created = await ctx.runMutation(
      components.betterAuth.adapter.create,
      {
        input: {
          model: 'member',
          data: {
            organizationId: args.organizationId,
            userId: existingUserId,
            role: (args.role ?? 'member').toLowerCase(),
            createdAt: Date.now(),
          },
        },
      },
    );
    const createdRec = isRecord(created) ? created : undefined;
    const memberId: string =
      (createdRec ? getString(createdRec, '_id') : undefined) ??
      (createdRec ? getString(createdRec, 'id') : undefined) ??
      String(created);

    return {
      userId: existingUserId,
      memberId,
      isExistingUser: true,
    };
  }

  // User doesn't exist — create a new account
  if (!args.password) {
    throw new Error('Password is required when creating a new user');
  }

  const auth = createAuth(ctx);

  const signupResult = await auth.api.signUpEmail({
    body: {
      email: args.email,
      password: args.password,
      name: args.displayName ?? '',
    },
  });

  if (!signupResult) {
    throw new Error('Failed to create user account');
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
          value: args.email,
          operator: 'eq',
        },
      ],
    },
  );

  if (!userResult || userResult.page.length === 0) {
    throw new Error(
      'Failed to retrieve user after signup. ' +
        'The user was created in Better Auth but could not be found. ' +
        'Email: ' +
        args.email,
    );
  }

  const betterAuthUserId = userResult.page[0]._id;

  const created = await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: 'member',
      data: {
        organizationId: args.organizationId,
        userId: betterAuthUserId,
        role: (args.role ?? 'member').toLowerCase(),
        createdAt: Date.now(),
      },
    },
  });
  const createdRecord = isRecord(created) ? created : undefined;
  const memberId: string =
    (createdRecord ? getString(createdRecord, '_id') : undefined) ??
    (createdRecord ? getString(createdRecord, 'id') : undefined) ??
    String(created);

  return {
    userId: betterAuthUserId,
    memberId,
    isExistingUser: false,
  };
}
