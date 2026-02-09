/**
 * Add member internal - Business logic
 */

import type { Role } from './types';

import { components } from '../_generated/api';
import { MutationCtx } from '../_generated/server';

export interface AddMemberInternalArgs {
  organizationId: string;
  email: string;
  identityId: string;
  role?: Role;
  displayName?: string;
}

export interface AddMemberInternalResult {
  memberId: string;
}

/**
 * Add a member without RLS checks.
 * Used internally to avoid circular dependencies.
 */
export async function addMemberInternal(
  ctx: MutationCtx,
  args: AddMemberInternalArgs,
): Promise<AddMemberInternalResult> {
  // Create member record in Better Auth (no RLS here by design)
  const created = await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: 'member',
      data: {
        organizationId: args.organizationId,
        userId: args.identityId,
        role: (args.role ?? 'member').toLowerCase(),
        createdAt: Date.now(),
      },
    },
  });
  // Better Auth adapter.create returns untyped data (any)
  const rawId = created?._id ?? created?.id;
  const memberId = typeof rawId === 'string' ? rawId : String(created);

  return {
    memberId,
  };
}
