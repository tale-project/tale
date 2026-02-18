/**
 * Set member password - Business logic
 *
 * Allows admins and owners to set a password for any org member,
 * including OAuth-only users who don't yet have a credential account.
 */

import { hashPassword } from 'better-auth/crypto';

import { isRecord, getString } from '../../lib/utils/type-guards';
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
  const memberRaw = memberRes?.page?.[0];
  const member = isRecord(memberRaw) ? memberRaw : undefined;
  const memberOrgId = member ? getString(member, 'organizationId') : undefined;
  if (!memberOrgId) {
    throw new Error('Member not found');
  }

  if (!member) {
    throw new Error('Member not found');
  }
  const memberUserId = getString(member, 'userId');
  if (!memberUserId) {
    throw new Error('Member missing userId');
  }

  // Verify caller is an admin or owner of this organization
  const callerRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [
      {
        field: 'organizationId',
        value: memberOrgId,
        operator: 'eq',
      },
      { field: 'userId', value: String(authUser._id), operator: 'eq' },
    ],
  });
  const callerMemberRaw = callerRes?.page?.[0];
  const callerMemberRec = isRecord(callerMemberRaw)
    ? callerMemberRaw
    : undefined;
  const callerRole = callerMemberRec
    ? getString(callerMemberRec, 'role')?.toLowerCase()
    : undefined;
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
        { field: 'userId', value: memberUserId, operator: 'eq' },
        { field: 'providerId', value: 'credential', operator: 'eq' },
      ],
    },
  );
  const credentialRaw = accountRes?.page?.[0];
  const existingCredential = isRecord(credentialRaw)
    ? credentialRaw
    : undefined;

  const passwordHash = await hashPassword(args.newPassword);

  if (existingCredential) {
    const credentialId = getString(existingCredential, '_id');
    if (!credentialId) throw new Error('Credential account missing _id');
    // Update existing credential account password
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
    // Create a new credential account for this user
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'account',
        data: {
          userId: memberUserId,
          providerId: 'credential',
          accountId: memberUserId,
          password: passwordHash,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    });
  }
}
