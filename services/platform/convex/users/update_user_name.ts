/**
 * Update user name - Business logic
 */

import { isRecord, getString } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { MutationCtx } from '../_generated/server';
import { authComponent } from '../auth';

export interface UpdateUserNameArgs {
  name: string;
}

export async function updateUserName(
  ctx: MutationCtx,
  args: UpdateUserNameArgs,
): Promise<void> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throw new Error('Unauthenticated');
  }

  const trimmed = args.name.trim();
  if (trimmed.length === 0) {
    throw new Error('Name is required');
  }
  if (trimmed.length > 100) {
    throw new Error('Name must be 100 characters or less');
  }

  // Look up the user record to get its _id
  const userRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'user',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [{ field: '_id', value: String(authUser._id), operator: 'eq' }],
  });
  const userRaw = userRes?.page?.[0];
  const user = isRecord(userRaw) ? userRaw : undefined;
  const userId = user ? getString(user, '_id') : undefined;
  if (!userId) {
    throw new Error('User not found');
  }

  await ctx.runMutation(components.betterAuth.adapter.updateMany, {
    input: {
      model: 'user',
      where: [{ field: '_id', value: userId, operator: 'eq' }],
      update: {
        name: trimmed,
        updatedAt: Date.now(),
      },
    },
    paginationOpts: { cursor: null, numItems: 1 },
  });
}
