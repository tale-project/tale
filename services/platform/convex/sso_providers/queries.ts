import { v } from 'convex/values';

import { query } from '../_generated/server';
import { get as getFn } from './get';
import { getMicrosoftToken as getMicrosoftTokenFn } from './get_microsoft_token';
import { isSsoConfigured as isSsoConfiguredFn } from './is_sso_configured';
import {
  platformRoleValidator,
  roleMappingRuleValidator,
  providerFeaturesValidator,
} from './validators';

export const get = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id('ssoProviders'),
      organizationId: v.string(),
      providerId: v.string(),
      issuer: v.string(),
      scopes: v.array(v.string()),
      autoProvisionRole: v.boolean(),
      roleMappingRules: v.array(roleMappingRuleValidator),
      defaultRole: platformRoleValidator,
      providerFeatures: v.optional(providerFeaturesValidator),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => getFn(ctx),
});

export const isSsoConfigured = query({
  args: {},
  returns: v.object({
    enabled: v.boolean(),
    providerType: v.optional(v.string()),
  }),
  handler: async (ctx) => isSsoConfiguredFn(ctx),
});

export const getMicrosoftToken = query({
  args: {},
  returns: v.union(
    v.object({
      accessToken: v.union(v.string(), v.null()),
      refreshToken: v.union(v.string(), v.null()),
      expiresAt: v.union(v.number(), v.null()),
      isExpired: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx) => getMicrosoftTokenFn(ctx),
});
