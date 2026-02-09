/**
 * Set member password - Business logic
 *
 * Allows admins and owners to set a password for any org member,
 * including OAuth-only users who don't yet have a credential account.
 */

import { hashPassword } from 'better-auth/crypto';

import { components } from '../_generated/api';
import { MutationCtx } from '../_generated/server';
import { authComponent } from '../auth';

export interface SetMemberPasswordArgs {
  memberId: string;
  newPassword: string;
}

export async function setMemberPassword(
  ctx: MutationCtx,
  args: SetMemberPasswordArgs,
): Promise<void> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throw new Error('Unauthenticated');
  }

  // Look up the target member
  const memberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
  });
  const member = memberRes?.page?.[0] as
    | { _id: string; organizationId: string; userId: string; role: string }
    | undefined;
  if (!member?.organizationId) {
    throw new Error('Member not found');
  }

  // Verify caller is an admin or owner of this organization
  const callerRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [
      {
        field: 'organizationId',
        value: member.organizationId,
        operator: 'eq',
      },
      { field: 'userId', value: String(authUser._id), operator: 'eq' },
    ],
  });
  const callerMember = callerRes?.page?.[0] as { role: string } | undefined;
  const callerRole = callerMember?.role?.toLowerCase();
  if (callerRole !== 'admin' && callerRole !== 'owner') {
    throw new Error('Only admins and owners can set member passwords');
  }

  // Check if the target user already has a credential account
  const accountRes = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'account',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        { field: 'userId', value: member.userId, operator: 'eq' },
        { field: 'providerId', value: 'credential', operator: 'eq' },
      ],
    },
  );
  const existingCredential = accountRes?.page?.[0] as
    | { _id: string }
    | undefined;

  const passwordHash = await hashPassword(args.newPassword);

  if (existingCredential) {
    // Update existing credential account password
    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'account',
        where: [
          { field: '_id', value: existingCredential._id, operator: 'eq' },
        ],
        update: {
          password: passwordHash,
          updatedAt: Date.now(),
        },
      },
      paginationOpts: { cursor: null, numItems: 1 },
    });
  } else {
    // Create a new credential account for this user
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'account',
        data: {
          userId: member.userId,
          providerId: 'credential',
          accountId: member.userId,
          password: passwordHash,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    });
  }
}
