/**
 * Loopback-only helpers for manual / CI e2e of auth email normalization.
 * Refuses to run when SITE_URL is not localhost — never on production hosts.
 */

import { v } from 'convex/values';

import { getString, isRecord } from '../../../lib/utils/type-utils';
import { components } from '../../_generated/api';
import { internalMutation, internalQuery } from '../../_generated/server';
import { hashScimToken, scimTokenPrefix } from '../../scim/helpers/crypto';
import {
  findUserByNormalizedEmail,
  findUsersByNormalizedEmail,
} from './find_user_by_normalized_email';
import { normalizeAuthEmail } from './normalize_auth_email';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function assertLoopback(): void {
  const siteUrl = process.env.SITE_URL ?? 'http://127.0.0.1:3000';
  let hostname: string;
  try {
    hostname = new URL(siteUrl).hostname;
  } catch {
    throw new Error(`Refusing e2e harness: invalid SITE_URL ${siteUrl}`);
  }
  if (!LOOPBACK.has(hostname)) {
    throw new Error(
      `Refusing e2e harness on non-loopback SITE_URL host "${hostname}"`,
    );
  }
}

/** Install a known SCIM bearer token for HTTP-level e2e (hash stored, plaintext returned once). */
export const seedScimBearerToken = internalMutation({
  args: { organizationId: v.string(), token: v.string() },
  returns: v.object({ tokenPrefix: v.string() }),
  handler: async (ctx, args) => {
    assertLoopback();
    const tokenHash = await hashScimToken(args.token);
    const tokenPrefix = scimTokenPrefix(args.token);
    const now = Date.now();
    const row = await ctx.db
      .query('ssoConnections')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .first();
    if (row) {
      await ctx.db.patch(row._id, {
        scimEnabled: true,
        scimTokenHash: tokenHash,
        scimTokenPrefix: tokenPrefix,
        scimTokenGeneratedAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('ssoConnections', {
        organizationId: args.organizationId,
        scimEnabled: true,
        scimTokenHash: tokenHash,
        scimTokenPrefix: tokenPrefix,
        scimTokenGeneratedAt: now,
        createdBy: 'e2e-harness',
        createdAt: now,
        updatedAt: now,
      });
    }
    return { tokenPrefix };
  },
});

export const findAuthUserIdByNormalizedEmail = internalQuery({
  args: { email: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    assertLoopback();
    const user = await findUserByNormalizedEmail(ctx, args.email);
    return user?._id ?? null;
  },
});

/** Create a global Better Auth user with no org membership (SCIM attach scenario). */
export const seedAuthUserForE2E = internalMutation({
  args: { email: v.string(), name: v.string() },
  returns: v.object({ userId: v.string(), email: v.string() }),
  handler: async (ctx, args) => {
    assertLoopback();
    const email = normalizeAuthEmail(args.email);
    const existing = await findUserByNormalizedEmail(ctx, email);
    if (existing) {
      return { userId: existing._id, email: existing.email };
    }
    const now = Date.now();
    const created = await ctx.runMutation(
      components.betterAuth.adapter.create,
      {
        input: {
          model: 'user',
          data: {
            email,
            name: args.name,
            emailVerified: false,
            createdAt: now,
            updatedAt: now,
          },
        },
      },
    );
    const userId = isRecord(created)
      ? (getString(created, '_id') ?? getString(created, 'id'))
      : undefined;
    if (!userId) throw new Error('Failed to create e2e user');
    return { userId, email };
  },
});

export const countAuthUsersByNormalizedEmail = internalQuery({
  args: { email: v.string() },
  returns: v.object({
    normalized: v.string(),
    count: v.number(),
    userIds: v.array(v.string()),
    emails: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    assertLoopback();
    const normalized = normalizeAuthEmail(args.email);
    const users = await findUsersByNormalizedEmail(ctx, args.email);
    return {
      normalized,
      count: users.length,
      userIds: users.map((u) => u._id),
      emails: users.map((u) => u.email),
    };
  },
});

/** Delete test users by id (Better Auth component). Loopback-only cleanup. */
export const deleteAuthUsersById = internalMutation({
  args: { userIds: v.array(v.string()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    assertLoopback();
    let deleted = 0;
    for (const userId of args.userIds) {
      await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        input: {
          model: 'user',
          where: [{ field: '_id', value: userId, operator: 'eq' }],
        },
      });
      deleted++;
    }
    return deleted;
  },
});
