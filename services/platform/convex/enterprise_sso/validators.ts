import { v } from 'convex/values';

/**
 * Convex validators for the unified Enterprise SSO model. Mirrors
 * `lib/shared/schemas/enterprise_sso.ts`. Stored configs carry ENCRYPTED
 * secrets (`*Encrypted` fields); the read-facing config queries strip them.
 */

export const platformRoleValidator = v.union(
  v.literal('admin'),
  v.literal('developer'),
  v.literal('editor'),
  v.literal('member'),
  v.literal('disabled'),
);

export const ssoProtocolValidator = v.union(
  v.literal('oidc'),
  v.literal('oauth2'),
  v.literal('saml'),
);

export const roleMappingSourceValidator = v.union(
  v.literal('jobTitle'),
  v.literal('appRole'),
  v.literal('group'),
  v.literal('claim'),
);

export const roleMappingRuleValidator = v.object({
  source: roleMappingSourceValidator,
  pattern: v.string(),
  targetRole: platformRoleValidator,
  claim: v.optional(v.string()),
});

export const attributeMappingValidator = v.object({
  email: v.optional(v.string()),
  name: v.optional(v.string()),
  groups: v.optional(v.string()),
});

export const ssoProviderIdValidator = v.union(
  v.literal('entra-id'),
  v.literal('generic-oidc'),
  v.literal('oauth2'),
);

export const ssoResourceTypeValidator = v.union(
  v.literal('User'),
  v.literal('Group'),
);
