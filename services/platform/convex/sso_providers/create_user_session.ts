/**
 * Create user session using Convex component adapter with Better Auth token format
 */

import { generateId } from 'better-auth';

import { components } from '../_generated/api';
import { MutationCtx } from '../_generated/server';

type CreateUserSessionArgs = {
  userId: string;
  organizationId: string;
};

type CreateUserSessionResult = {
  sessionToken: string | null;
  sessionId: string | null;
};

export async function createUserSession(
  ctx: MutationCtx,
  args: CreateUserSessionArgs,
): Promise<CreateUserSessionResult> {
  const sessionToken = generateId(32);
  const now = Date.now();
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 days

  const createResult = await ctx.runMutation(
    components.betterAuth.adapter.create,
    {
      input: {
        model: 'session',
        data: {
          userId: args.userId,
          token: sessionToken,
          expiresAt,
          createdAt: now,
          updatedAt: now,
          activeOrganizationId: args.organizationId,
        },
      },
    },
  );

  const sessionId =
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- third-party type
    (createResult as { _id?: string; id?: string })?._id ??
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- third-party type
    (createResult as { _id?: string; id?: string })?.id ??
    null;

  console.log('[createUserSession] Session created:', {
    id: sessionId,
    userId: args.userId,
  });

  return { sessionToken, sessionId };
}
