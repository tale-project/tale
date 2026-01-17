import { mutation, internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';
import * as TrustedHeadersAuthModel from './model/trusted_headers_authenticate';

// Team entry with required ID and name
const teamEntryValidator = v.object({
  id: v.string(),
  name: v.string(),
});

// Public mutation: full trusted-headers auth flow
export const trustedHeadersAuthenticate = mutation({
  args: {
    email: v.string(),
    name: v.string(),
    role: v.string(),
    teams: v.union(v.array(teamEntryValidator), v.null()),
    existingSessionToken: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    secret: v.optional(v.string()),
  },
  returns: v.object({
    userId: v.string(),
    organizationId: v.union(v.string(), v.null()),
    sessionToken: v.string(),
    shouldClearOldSession: v.boolean(),
    trustedHeadersChanged: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await TrustedHeadersAuthModel.trustedHeadersAuthenticate(ctx, args);
  },
});

// Internal thin wrappers co-located here (file acts as API module)

export const findOrCreateUserFromHeaders = internalMutation({
  args: {
    email: v.string(),
    name: v.string(),
    role: v.string(),
  },
  returns: v.object({
    userId: v.string(),
    organizationId: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    return await TrustedHeadersAuthModel.findOrCreateUserFromHeaders(ctx, args);
  },
});

export const getUserById = internalQuery({
  args: {
    userId: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.string(),
      _creationTime: v.number(),
      name: v.string(),
      email: v.string(),
      emailVerified: v.boolean(),
      image: v.optional(v.union(v.null(), v.string())),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await TrustedHeadersAuthModel.getUserById(ctx, args.userId);
  },
});

export const createSessionForTrustedUser = internalMutation({
  args: {
    userId: v.string(),
    existingSessionToken: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    trustedRole: v.optional(v.string()),
    trustedTeamIds: v.optional(v.string()),
  },
  returns: v.object({
    sessionToken: v.string(),
    shouldClearOldSession: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await TrustedHeadersAuthModel.createSessionForTrustedUser(ctx, args);
  },
});
