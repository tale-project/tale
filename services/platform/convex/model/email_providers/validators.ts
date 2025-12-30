/**
 * Convex validators for email providers
 */

import { v } from 'convex/values';

export const emailProviderVendorValidator = v.union(
  v.literal('gmail'),
  v.literal('outlook'),
  v.literal('smtp'),
  v.literal('resend'),
  v.literal('other'),
);

export const emailProviderAuthMethodValidator = v.union(
  v.literal('password'),
  v.literal('oauth2'),
);

export const emailProviderStatusValidator = v.union(
  v.literal('active'),
  v.literal('error'),
  v.literal('testing'),
);

export const smtpConfigValidator = v.object({
  host: v.string(),
  port: v.number(),
  secure: v.boolean(),
});

export const imapConfigValidator = v.object({
  host: v.string(),
  port: v.number(),
  secure: v.boolean(),
});

/**
 * Validator for email provider document (for query returns)
 */
export const emailProviderDocValidator = v.object({
  _id: v.id('emailProviders'),
  _creationTime: v.number(),
  organizationId: v.string(),
  name: v.string(),
  vendor: emailProviderVendorValidator,
  authMethod: emailProviderAuthMethodValidator,
  sendMethod: v.optional(v.union(v.literal('smtp'), v.literal('api'))),
  passwordAuth: v.optional(
    v.object({
      user: v.string(),
      passEncrypted: v.string(),
    }),
  ),
  oauth2Auth: v.optional(
    v.object({
      provider: v.string(),
      clientId: v.string(),
      clientSecretEncrypted: v.string(),
      accessTokenEncrypted: v.optional(v.string()),
      refreshTokenEncrypted: v.optional(v.string()),
      tokenExpiry: v.optional(v.number()),
      tokenUrl: v.optional(v.string()),
    }),
  ),
  smtpConfig: v.optional(smtpConfigValidator),
  imapConfig: v.optional(imapConfigValidator),
  isActive: v.optional(v.boolean()),
  isDefault: v.boolean(),
  status: v.optional(emailProviderStatusValidator),
  lastTestedAt: v.optional(v.number()),
  lastSyncAt: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
  metadata: v.optional(v.any()),
});
