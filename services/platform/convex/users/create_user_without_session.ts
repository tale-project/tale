/**
 * Create user without session - Business logic
 */

import type { Role } from './types';

import { components } from '../_generated/api';
import { MutationCtx } from '../_generated/server';
import { createAuth } from '../auth';

export interface CreateUserWithoutSessionArgs {
  email: string;
  password: string;
  name?: string;
  organizationId: string;
  role?: Role;
  displayName?: string;
}

export interface CreateUserWithoutSessionResult {
  userId: string;
  memberId: string;
}

/**
 * Create a user account without creating a session.
 * This is used by admins to create accounts for other users.
 *
 * IMPORTANT: This does NOT create a session, so the admin's session remains active.
 * This function uses Better Auth's API directly to create users with proper password hashing.
 *
 * Architecture:
 * - Better Auth manages authentication and stores user credentials
 * - We store Better Auth's internal user ID (_id) as identityId in our members table
 * - This links our member records to Better Auth users
 */
export async function createUserWithoutSession(
  ctx: MutationCtx,
  args: CreateUserWithoutSessionArgs,
): Promise<CreateUserWithoutSessionResult> {
  // First check if user already exists by querying Better Auth directly
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

  if (existingUserResult && existingUserResult.page.length > 0) {
    throw new Error('A user with this email already exists');
  }

  // Create Better Auth instance
  const auth = createAuth(ctx);

  // Use Better Auth's API to create the user with proper password hashing
  // This does NOT create a session, so the admin's session remains active
  const signupResult = await auth.api.signUpEmail({
    body: {
      email: args.email,
      password: args.password,
      name: args.name ?? args.displayName ?? '',
    },
  });

  if (!signupResult) {
    throw new Error('Failed to create user account');
  }

  // Query Better Auth to get the created user's internal ID
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

  // Use the Better Auth user's internal ID (_id) as the identityId
  const betterAuthUserId = userResult.page[0]._id;

  // Create member record in Better Auth
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
  const createdRecord = created as unknown as
    | Record<string, unknown>
    | undefined;
  const memberId: string =
    (createdRecord?._id as string) ??
    (createdRecord?.id as string) ??
    String(created);

  return {
    userId: betterAuthUserId,
    memberId,
  };
}
