/**
 * Business logic for creating or reusing a Better Auth session for
 * a trusted-headers user, including account switching semantics.
 */

import type { MutationCtx } from '../../_generated/server';
import { components } from '../../_generated/api';

export interface CreateSessionForTrustedUserArgs {
  userId: string;
  existingSessionToken?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface CreateSessionForTrustedUserResult {
  sessionToken: string;
  shouldClearOldSession: boolean;
}

export async function createSessionForTrustedUser(
  ctx: MutationCtx,
  args: CreateSessionForTrustedUserArgs,
): Promise<CreateSessionForTrustedUserResult> {
  const now = Date.now();

  // If there's an existing session token, check if it belongs to a different user
  if (args.existingSessionToken) {
    const existingSessionResult = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
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
      },
    );

    if (existingSessionResult && existingSessionResult.page.length > 0) {
      const existingSession = existingSessionResult.page[0] as any;

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
        // Same user, session still valid - extend it and return
        await ctx.runMutation(components.betterAuth.adapter.updateOne, {
          input: {
            model: 'session',
            update: {
              expiresAt: now + 24 * 60 * 60 * 1000,
              updatedAt: now,
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
        };
      }
    }
  }

  // Look for any existing valid session for this user
  const userSessionResult = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
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
    },
  );

  // If we have a valid session for this user, reuse it
  if (userSessionResult && userSessionResult.page.length > 0) {
    const session = userSessionResult.page[0] as any;
    if (session.expiresAt > now) {
      await ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: {
          model: 'session',
          update: {
            expiresAt: now + 24 * 60 * 60 * 1000,
            updatedAt: now,
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
      },
    },
  });

  return {
    sessionToken,
    shouldClearOldSession: args.existingSessionToken ? true : false,
  };
}
