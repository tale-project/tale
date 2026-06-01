/**
 * Create user session using Convex component adapter with Better Auth token format
 */

import { generateId } from 'better-auth';

import { sessionExpiryMs } from '../../lib/shared/session-idle';
import { isRecord, getString } from '../../lib/utils/type-guards';
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
  // 30 days unless a session idle timeout is configured (#1502).
  const expiresAt = sessionExpiryMs(now, 30 * 24 * 60 * 60 * 1000);

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

  const createResultRec = isRecord(createResult) ? createResult : undefined;
  const sessionId =
    (createResultRec ? getString(createResultRec, '_id') : undefined) ??
    (createResultRec ? getString(createResultRec, 'id') : undefined) ??
    null;

  console.log('[createUserSession] Session created:', {
    id: sessionId,
    userId: args.userId,
  });

  return { sessionToken, sessionId };
}
