/**
 * Add member internal - Business logic
 */

import { MutationCtx } from '../_generated/server';
import type { Role } from './types';
import { components } from '../_generated/api';

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
  const memberId: string =
    (created as any)?._id ?? (created as any)?.id ?? String(created);

  return {
    memberId,
  };
}
