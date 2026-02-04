/**
 * Create user session using Convex component adapter with Better Auth token format
 */

import { MutationCtx } from '../_generated/server';
import { components } from '../_generated/api';
import { generateId } from 'better-auth';

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionId = (createResult as any)?._id ?? (createResult as any)?.id;

  console.log('[createUserSession] Session created:', {
    id: sessionId,
    userId: args.userId,
  });

  return { sessionToken, sessionId };
}
