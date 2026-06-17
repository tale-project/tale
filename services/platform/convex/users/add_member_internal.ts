/**
 * Add member internal - Business logic
 */

import { components } from '../_generated/api';
import { MutationCtx } from '../_generated/server';
import { upsertMemberMirror } from '../members/mirror_sync';
import type { Role } from './types';

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
  const role = (args.role ?? 'member').toLowerCase();
  const createdAt = Date.now();
  const created = await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: 'member',
      data: {
        organizationId: args.organizationId,
        userId: args.identityId,
        role,
        createdAt,
      },
    },
  });
  // Better Auth adapter.create returns untyped data (any)
  const rawId = created?._id ?? created?.id;
  const memberId = typeof rawId === 'string' ? rawId : String(created);

  // Seed the RLS read cache with the new membership.
  await upsertMemberMirror(ctx, {
    memberId,
    userId: args.identityId,
    organizationId: args.organizationId,
    role,
    createdAt,
  });

  return {
    memberId,
  };
}
