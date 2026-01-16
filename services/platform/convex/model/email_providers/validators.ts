/**
 * Convex validators for email providers
 */

import { v } from 'convex/values';
import { jsonRecordValidator } from '../../../lib/shared/validators/utils/json-value';

const emailProviderVendorValidator = v.union(
  v.literal('gmail'),
  v.literal('outlook'),
  v.literal('smtp'),
  v.literal('resend'),
  v.literal('other'),
);

const emailProviderAuthMethodValidator = v.union(
  v.literal('password'),
  v.literal('oauth2'),
);

const emailProviderStatusValidator = v.union(
  v.literal('active'),
  v.literal('error'),
  v.literal('testing'),
);

const smtpConfigValidator = v.object({
  host: v.string(),
  port: v.number(),
  secure: v.boolean(),
});

const imapConfigValidator = v.object({
  host: v.string(),
  port: v.number(),
  secure: v.boolean(),
});

const sendMethodValidator = v.union(
  v.literal('smtp'),
  v.literal('api'),
);

const accountTypeValidator = v.union(
  v.literal('personal'),
  v.literal('organizational'),
  v.literal('both'),
);

const passwordAuthValidator = v.object({
  user: v.string(),
  pass: v.string(),
});

const passwordAuthEncryptedValidator = v.object({
  user: v.string(),
  passEncrypted: v.string(),
});

const oauth2AuthInputValidator = v.object({
  provider: v.string(),
  clientId: v.string(),
  clientSecret: v.string(),
  tokenUrl: v.optional(v.string()),
});

const oauth2AuthStoredValidator = v.object({
  provider: v.string(),
  clientId: v.string(),
  clientSecretEncrypted: v.string(),
  accessTokenEncrypted: v.optional(v.string()),
  refreshTokenEncrypted: v.optional(v.string()),
  tokenExpiry: v.optional(v.number()),
  tokenUrl: v.optional(v.string()),
});

const oauth2AuthSimpleValidator = v.object({
  user: v.string(),
  accessToken: v.string(),
});

const connectionTestItemValidator = v.object({
  success: v.boolean(),
  latencyMs: v.number(),
  error: v.optional(v.string()),
});

const connectionTestResultValidator = v.object({
  success: v.boolean(),
  smtp: connectionTestItemValidator,
  imap: connectionTestItemValidator,
});

const oauth2CallbackResponseValidator = v.object({
  success: v.boolean(),
  userEmail: v.optional(v.string()),
  redirectUri: v.optional(v.string()),
  redirectOrigin: v.optional(v.string()),
});

const sendMessageResponseValidator = v.object({
  success: v.boolean(),
  messageId: v.optional(v.string()),
});

const emailProviderDocValidator = v.object({
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
  metadata: v.optional(jsonRecordValidator),
});
