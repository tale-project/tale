/**
 * SSO Providers Internal Mutations
 *
 * Internal mutations for SSO provider operations.
 */

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { components } from '../_generated/api';
import * as AuditLogHelpers from '../audit_logs/helpers';

export const upsertProvider = internalMutation({
  args: {
    organizationId: v.string(),
    providerId: v.string(),
    issuer: v.string(),
    domain: v.string(),
    clientIdEncrypted: v.string(),
    clientSecretEncrypted: v.string(),
    scopes: v.array(v.string()),
    autoProvisionEnabled: v.boolean(),
    excludeGroups: v.array(v.string()),
    teamMembershipMode: v.union(v.literal('sync'), v.literal('additive')),
    actorId: v.string(),
    actorEmail: v.string(),
    actorRole: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('ssoProviders')
      .withIndex('organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();

    const now = Date.now();
    let providerId: string;
    let isNew = false;

    if (existing) {
      await ctx.db.patch(existing._id, {
        providerId: args.providerId,
        issuer: args.issuer,
        domain: args.domain,
        clientIdEncrypted: args.clientIdEncrypted,
        clientSecretEncrypted: args.clientSecretEncrypted,
        scopes: args.scopes,
        autoProvisionEnabled: args.autoProvisionEnabled,
        excludeGroups: args.excludeGroups,
        teamMembershipMode: args.teamMembershipMode,
        updatedAt: now,
      });
      providerId = existing._id;
    } else {
      isNew = true;
      providerId = await ctx.db.insert('ssoProviders', {
        organizationId: args.organizationId,
        providerId: args.providerId,
        issuer: args.issuer,
        domain: args.domain,
        clientIdEncrypted: args.clientIdEncrypted,
        clientSecretEncrypted: args.clientSecretEncrypted,
        scopes: args.scopes,
        autoProvisionEnabled: args.autoProvisionEnabled,
        excludeGroups: args.excludeGroups,
        teamMembershipMode: args.teamMembershipMode,
        createdAt: now,
        updatedAt: now,
      });
    }

    await AuditLogHelpers.logSuccess(
      ctx,
      {
        organizationId: args.organizationId,
        actor: {
          id: args.actorId,
          email: args.actorEmail,
          role: args.actorRole,
          type: 'user',
        },
      },
      isNew ? 'sso_provider_created' : 'sso_provider_updated',
      'integration',
      'ssoProvider',
      providerId,
      args.domain,
      undefined,
      {
        providerId: args.providerId,
        domain: args.domain,
        autoProvisionEnabled: args.autoProvisionEnabled,
      },
    );

    return providerId;
  },
});

export const removeProvider = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    actorEmail: v.string(),
    actorRole: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('ssoProviders')
      .withIndex('organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();

    if (!existing) {
      return null;
    }

    await ctx.db.delete(existing._id);

    await AuditLogHelpers.logSuccess(
      ctx,
      {
        organizationId: args.organizationId,
        actor: {
          id: args.actorId,
          email: args.actorEmail,
          role: args.actorRole,
          type: 'user',
        },
      },
      'sso_provider_deleted',
      'integration',
      'ssoProvider',
      existing._id,
      existing.domain,
      {
        providerId: existing.providerId,
        domain: existing.domain,
      },
      undefined,
    );

    return null;
  },
});

export const findOrCreateSsoUser = internalMutation({
  args: {
    email: v.string(),
    name: v.string(),
    microsoftId: v.string(),
    accessToken: v.string(),
  },
  returns: v.object({
    userId: v.union(v.string(), v.null()),
    isNewUser: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Find existing user by email
    const existingUserRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: 'email', value: args.email, operator: 'eq' }],
    });

    const existingUser = existingUserRes?.page?.[0] as { _id?: string; id?: string } | undefined;
    const existingUserId = existingUser?._id ?? existingUser?.id;

    if (existingUserId) {
      // Check if Microsoft account is already linked
      const existingAccountRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'account',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          { field: 'userId', value: existingUserId, operator: 'eq' },
          { field: 'providerId', value: 'microsoft', operator: 'eq' },
        ],
      });

      const existingAccount = existingAccountRes?.page?.[0] as { _id?: string } | undefined;

      if (!existingAccount) {
        // Link Microsoft account to existing user
        const now = Date.now();
        await ctx.runMutation(components.betterAuth.adapter.create, {
          input: {
            model: 'account',
            data: {
              userId: existingUserId,
              providerId: 'microsoft',
              accountId: args.microsoftId,
              accessToken: args.accessToken,
              createdAt: now,
              updatedAt: now,
            },
          },
        });
      } else {
        // Update access token using updateMany
        await ctx.runMutation(components.betterAuth.adapter.updateMany, {
          input: {
            model: 'account' as const,
            where: [{ field: '_id', value: existingAccount._id, operator: 'eq' }],
            update: {
              accessToken: args.accessToken,
              updatedAt: Date.now(),
            },
          },
          paginationOpts: { cursor: null, numItems: 1 },
        });
      }

      return { userId: existingUserId, isNewUser: false };
    }

    // Create new user
    const now = Date.now();
    const createResult = await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'user',
        data: {
          email: args.email,
          name: args.name,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    });

    const userId: string = (createResult as any)?._id ?? (createResult as any)?.id ?? String(createResult);

    // Create Microsoft account link
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'account',
        data: {
          userId,
          providerId: 'microsoft',
          accountId: args.microsoftId,
          accessToken: args.accessToken,
          createdAt: now,
          updatedAt: now,
        },
      },
    });

    return { userId, isNewUser: true };
  },
});

export const createUserSession = internalMutation({
  args: {
    userId: v.string(),
    organizationId: v.string(),
  },
  returns: v.object({
    sessionToken: v.union(v.string(), v.null()),
    sessionId: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const sessionToken = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 days

    // Create session via Better Auth adapter
    const createResult = await ctx.runMutation(components.betterAuth.adapter.create, {
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
    });

    const sessionId: string = (createResult as any)?._id ?? (createResult as any)?.id ?? String(createResult);

    return { sessionToken, sessionId };
  },
});
