/**
 * Business logic for creating or reusing a Better Auth session for
 * a trusted-headers user, including account switching semantics.
 */

import type { MutationCtx } from '../../_generated/server';
import { components } from '../../_generated/api';
import type {
  BetterAuthFindManyResult,
  BetterAuthSession,
} from '../../members/types';

export interface CreateSessionForTrustedUserArgs {
  userId: string;
  existingSessionToken?: string;
  ipAddress?: string;
  userAgent?: string;
  trustedRole?: string;
  trustedTeams?: string;
}

export interface CreateSessionForTrustedUserResult {
  sessionToken: string;
  shouldClearOldSession: boolean;
  trustedHeadersChanged: boolean;
}

export async function createSessionForTrustedUser(
  ctx: MutationCtx,
  args: CreateSessionForTrustedUserArgs,
): Promise<CreateSessionForTrustedUserResult> {
  const now = Date.now();

  // If there's an existing session token, check if it belongs to a different user
  if (args.existingSessionToken) {
    const existingSessionResult: BetterAuthFindManyResult<BetterAuthSession> =
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'session',
        paginationOpts: {
          cursor: null,
          numItems: 1,
        },
        where: [
          {
            field: 'token',
            value: args.existingSessionToken,
            operator: 'eq',
          },
        ],
      });

    if (existingSessionResult && existingSessionResult.page.length > 0) {
      const existingSession = existingSessionResult.page[0];

      // If the session belongs to a DIFFERENT user, delete it
      if (existingSession.userId !== args.userId) {
        await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
          input: {
            model: 'session',
            where: [
              {
                field: '_id',
                value: existingSession._id,
                operator: 'eq',
              },
            ],
          },
        });
        // Signal that we need to clear the old cookie
      } else if (existingSession.expiresAt > now) {
        // Same user, session still valid - extend it and update trusted fields
        // Check if trusted headers values have changed
        const sessionRecord = existingSession as unknown as Record<string, unknown>;
        const existingRole = sessionRecord.trustedRole as string | null | undefined;
        const existingTeams = sessionRecord.trustedTeams as string | null | undefined;
        const trustedHeadersChanged =
          (existingRole ?? null) !== (args.trustedRole ?? null) ||
          (existingTeams ?? null) !== (args.trustedTeams ?? null);

        await ctx.runMutation(components.betterAuth.adapter.updateOne, {
          input: {
            model: 'session',
            update: {
              expiresAt: now + 24 * 60 * 60 * 1000,
              updatedAt: now,
              trustedRole: args.trustedRole ?? null,
              trustedTeams: args.trustedTeams ?? null,
            },
            where: [
              {
                field: '_id',
                value: existingSession._id,
                operator: 'eq',
              },
            ],
          },
        });
        return {
          sessionToken: existingSession.token,
          shouldClearOldSession: false,
          trustedHeadersChanged,
        };
      }
    }
  }

  // Look for any existing valid session for this user
  const userSessionResult: BetterAuthFindManyResult<BetterAuthSession> =
    await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'session',
      paginationOpts: {
        cursor: null,
        numItems: 1,
      },
      where: [
        {
          field: 'userId',
          value: args.userId,
          operator: 'eq',
        },
      ],
    });

  // If we have a valid session for this user, reuse it
  if (userSessionResult && userSessionResult.page.length > 0) {
    const session = userSessionResult.page[0];
    if (session.expiresAt > now) {
      // Check if trusted headers values have changed
      const sessionRecord = session as unknown as Record<string, unknown>;
      const existingRole = sessionRecord.trustedRole as string | null | undefined;
      const existingTeams = sessionRecord.trustedTeams as string | null | undefined;
      const trustedHeadersChanged =
        (existingRole ?? null) !== (args.trustedRole ?? null) ||
        (existingTeams ?? null) !== (args.trustedTeams ?? null);

      await ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: {
          model: 'session',
          update: {
            expiresAt: now + 24 * 60 * 60 * 1000,
            updatedAt: now,
            trustedRole: args.trustedRole ?? null,
            trustedTeams: args.trustedTeams ?? null,
          },
          where: [
            {
              field: '_id',
              value: session._id,
              operator: 'eq',
            },
          ],
        },
      });
      return {
        sessionToken: session.token,
        shouldClearOldSession: args.existingSessionToken ? true : false,
        trustedHeadersChanged,
      };
    }
  }

  // No valid session found - create a new one
  // Use Web Crypto API instead of Node's `crypto` module so this runs in Convex's V8 runtime.
  const sessionToken = globalThis.crypto.randomUUID();
  const expiresAt = now + 24 * 60 * 60 * 1000;

  await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: 'session',
      data: {
        userId: args.userId,
        token: sessionToken,
        expiresAt,
        createdAt: now,
        updatedAt: now,
        ipAddress: args.ipAddress || null,
        userAgent: args.userAgent || null,
        trustedRole: args.trustedRole ?? null,
        trustedTeams: args.trustedTeams ?? null,
      },
    },
  });

  return {
    sessionToken,
    shouldClearOldSession: args.existingSessionToken ? true : false,
    trustedHeadersChanged: true,
  };
}
