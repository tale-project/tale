import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { components } from '../_generated/api';
import { getAuthUser as getAuthUserFn } from './get_auth_user';
import { getCallerRole as getCallerRoleFn } from './get_caller_role';
import { getSsoConfig as getSsoConfigFn } from './get_sso_config';

export const getAuthUser = internalQuery({
  args: {},
  returns: v.union(
    v.object({
      _id: v.string(),
      email: v.string(),
      name: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx) => getAuthUserFn(ctx),
});

export const getCallerRole = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => getCallerRoleFn(ctx, args),
});

const platformRoleValidator = v.union(
  v.literal('admin'),
  v.literal('developer'),
  v.literal('editor'),
  v.literal('member'),
  v.literal('disabled'),
);

const roleMappingRuleValidator = v.object({
  source: v.union(v.literal('jobTitle'), v.literal('appRole')),
  pattern: v.string(),
  targetRole: platformRoleValidator,
});

export const getSsoConfig = internalQuery({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id('ssoProviders'),
      organizationId: v.string(),
      providerId: v.string(),
      issuer: v.string(),
      clientIdEncrypted: v.string(),
      clientSecretEncrypted: v.string(),
      scopes: v.array(v.string()),
      autoProvisionTeam: v.boolean(),
      excludeGroups: v.array(v.string()),
      autoProvisionRole: v.boolean(),
      roleMappingRules: v.array(roleMappingRuleValidator),
      defaultRole: platformRoleValidator,
      enableOneDriveAccess: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => getSsoConfigFn(ctx),
});

export const getByOrganization = internalQuery({
  args: {
    organizationId: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id('ssoProviders'),
      clientIdEncrypted: v.string(),
      clientSecretEncrypted: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const provider = await ctx.db
      .query('ssoProviders')
      .withIndex('organizationId', (q) => q.eq('organizationId', args.organizationId))
      .first();

    if (!provider) {
      return null;
    }

    return {
      _id: provider._id,
      clientIdEncrypted: provider.clientIdEncrypted,
      clientSecretEncrypted: provider.clientSecretEncrypted,
    };
  },
});

export const debugGetSession = internalQuery({
  args: { token: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query('session')
      .filter((q) => q.eq(q.field('token'), args.token))
      .first();
    return session;
  },
});

export const debugListSessions = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const sessions = await ctx.db.query('session').take(10);
    return sessions;
  },
});

export const debugSessionViaComponent = internalQuery({
  args: { token: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Query session via Better Auth component adapter
    const session = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'session',
      where: [{ field: 'token', value: args.token, operator: 'eq' }],
    });

    if (!session) {
      return { session: null, user: null, error: 'Session not found' };
    }

    // Query user via Better Auth component adapter
    const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'user',
      where: [{ field: '_id', value: session.userId, operator: 'eq' }],
    });

    return {
      session,
      user,
      sessionKeys: Object.keys(session),
      userKeys: user ? Object.keys(user) : null,
    };
  },
});

export const debugSessionWithJoin = internalQuery({
  args: { token: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Query session WITH join via Better Auth component adapter
    // This simulates what Better Auth's findSession does
    const result = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'session',
      where: [{ field: 'token', value: args.token, operator: 'eq' }],
      join: { user: true },
    });

    return {
      result,
      hasUser: !!result?.user,
      resultKeys: result ? Object.keys(result) : null,
    };
  },
});

export const debugUserById = internalQuery({
  args: { userId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Test user query by 'id' field (Better Auth uses 'id', adapter transforms to '_id')
    const userById = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'user',
      where: [{ field: 'id', value: args.userId, operator: 'eq' }],
    });

    // Also test by '_id' directly
    const userByUnderscoreId = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'user',
      where: [{ field: '_id', value: args.userId, operator: 'eq' }],
    });

    return {
      userById,
      userByUnderscoreId,
      idFound: !!userById,
      underscoreIdFound: !!userByUnderscoreId,
    };
  },
});

export const debugFullSessionFlow = internalQuery({
  args: { token: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Import createAuth to get the actual Better Auth instance with the wrapped adapter
    const { createAuth } = await import('../auth');

    const auth = createAuth(ctx);

    // Get the internal adapter which has the transformations applied
    const internalAdapter = await auth.$context.then(c => c.adapter);

    // Query session using the actual Better Auth adapter
    const session = await internalAdapter.findOne({
      model: 'session',
      where: [{ field: 'token', value: args.token, operator: 'eq' }],
    });

    if (!session) {
      return { session: null, error: 'Session not found via Better Auth adapter' };
    }

    // Query user using the actual Better Auth adapter (should transform id to _id)
    const user = await internalAdapter.findOne({
      model: 'user',
      where: [{ field: 'id', value: session.userId, operator: 'eq' }],
    });

    return {
      session,
      user,
      userFound: !!user,
    };
  },
});
