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
 * Send method validator (SMTP or API)
 */
export const sendMethodValidator = v.union(
  v.literal('smtp'),
  v.literal('api'),
);

/**
 * Account type validator (for OAuth2)
 */
export const accountTypeValidator = v.union(
  v.literal('personal'),
  v.literal('organizational'),
  v.literal('both'),
);

/**
 * Password auth validator
 */
export const passwordAuthValidator = v.object({
  user: v.string(),
  pass: v.string(),
});

/**
 * Password auth encrypted validator (for internal storage)
 */
export const passwordAuthEncryptedValidator = v.object({
  user: v.string(),
  passEncrypted: v.string(),
});

/**
 * OAuth2 auth validator (for input)
 */
export const oauth2AuthInputValidator = v.object({
  provider: v.string(),
  clientId: v.string(),
  clientSecret: v.string(),
  tokenUrl: v.optional(v.string()),
});

/**
 * OAuth2 auth validator (for internal storage with encrypted fields)
 */
export const oauth2AuthStoredValidator = v.object({
  provider: v.string(),
  clientId: v.string(),
  clientSecretEncrypted: v.string(),
  accessTokenEncrypted: v.optional(v.string()),
  refreshTokenEncrypted: v.optional(v.string()),
  tokenExpiry: v.optional(v.number()),
  tokenUrl: v.optional(v.string()),
});

/**
 * OAuth2 auth simple validator (for testing connection)
 */
export const oauth2AuthSimpleValidator = v.object({
  user: v.string(),
  accessToken: v.string(),
});

/**
 * Connection test result item validator
 */
export const connectionTestItemValidator = v.object({
  success: v.boolean(),
  latencyMs: v.number(),
  error: v.optional(v.string()),
});

/**
 * Connection test result validator
 */
export const connectionTestResultValidator = v.object({
  success: v.boolean(),
  smtp: connectionTestItemValidator,
  imap: connectionTestItemValidator,
});

/**
 * OAuth2 callback response validator
 */
export const oauth2CallbackResponseValidator = v.object({
  success: v.boolean(),
  userEmail: v.optional(v.string()),
  redirectUri: v.optional(v.string()),
  redirectOrigin: v.optional(v.string()),
});

/**
 * Send message response validator
 */
export const sendMessageResponseValidator = v.object({
  success: v.boolean(),
  messageId: v.optional(v.string()),
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
  sendMethod: v.optional(sendMethodValidator),
  passwordAuth: v.optional(passwordAuthEncryptedValidator),
  oauth2Auth: v.optional(oauth2AuthStoredValidator),
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
