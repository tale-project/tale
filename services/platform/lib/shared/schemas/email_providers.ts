import { z } from 'zod/v4';

import { jsonRecordSchema } from './utils/json-value';

const emailProviderVendorLiterals = [
  'gmail',
  'outlook',
  'smtp',
  'resend',
  'other',
] as const;
export const emailProviderVendorSchema = z.enum(emailProviderVendorLiterals);
export type EmailProviderVendor = z.infer<typeof emailProviderVendorSchema>;

const emailProviderAuthMethodLiterals = ['password', 'oauth2'] as const;
export const emailProviderAuthMethodSchema = z.enum(
  emailProviderAuthMethodLiterals,
);
type EmailProviderAuthMethod = z.infer<typeof emailProviderAuthMethodSchema>;

const emailProviderStatusLiterals = [
  'active',
  'error',
  'testing',
  'pending_authorization',
] as const;
export const emailProviderStatusSchema = z.enum(emailProviderStatusLiterals);
type EmailProviderStatus = z.infer<typeof emailProviderStatusSchema>;

const sendMethodLiterals = ['smtp', 'api'] as const;
export const sendMethodSchema = z.enum(sendMethodLiterals);
type SendMethod = z.infer<typeof sendMethodSchema>;

const accountTypeLiterals = ['personal', 'organizational', 'both'] as const;
const accountTypeSchema = z.enum(accountTypeLiterals);
type AccountType = z.infer<typeof accountTypeSchema>;

export const smtpConfigSchema = z.object({
  host: z.string(),
  port: z.number(),
  secure: z.boolean(),
});
type SmtpConfig = z.infer<typeof smtpConfigSchema>;

export const imapConfigSchema = z.object({
  host: z.string(),
  port: z.number(),
  secure: z.boolean(),
});
type ImapConfig = z.infer<typeof imapConfigSchema>;

export const passwordAuthSchema = z.object({
  user: z.string(),
  pass: z.string(),
});
type PasswordAuth = z.infer<typeof passwordAuthSchema>;

export const passwordAuthEncryptedSchema = z.object({
  user: z.string(),
  passEncrypted: z.string(),
});
type PasswordAuthEncrypted = z.infer<typeof passwordAuthEncryptedSchema>;

const oauth2AuthInputSchema = z.object({
  provider: z.string(),
  clientId: z.string(),
  clientSecret: z.string(),
  tokenUrl: z.string().optional(),
});
type OAuth2AuthInput = z.infer<typeof oauth2AuthInputSchema>;

export const oauth2AuthStoredSchema = z.object({
  provider: z.string(),
  clientId: z.string(),
  clientSecretEncrypted: z.string(),
  accessTokenEncrypted: z.string().optional(),
  refreshTokenEncrypted: z.string().optional(),
  tokenExpiry: z.number().optional(),
  tokenUrl: z.string().optional(),
});
type OAuth2AuthStored = z.infer<typeof oauth2AuthStoredSchema>;

const oauth2AuthSimpleSchema = z.object({
  user: z.string(),
  accessToken: z.string(),
});
type OAuth2AuthSimple = z.infer<typeof oauth2AuthSimpleSchema>;

const connectionTestItemSchema = z.object({
  success: z.boolean(),
  latencyMs: z.number(),
  error: z.string().optional(),
});
type ConnectionTestItem = z.infer<typeof connectionTestItemSchema>;

export const connectionTestResultSchema = z.object({
  success: z.boolean(),
  smtp: connectionTestItemSchema,
  imap: connectionTestItemSchema,
});
type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>;

const oauth2CallbackResponseSchema = z.object({
  success: z.boolean(),
  userEmail: z.string().optional(),
  redirectUri: z.string().optional(),
  redirectOrigin: z.string().optional(),
});
type OAuth2CallbackResponse = z.infer<typeof oauth2CallbackResponseSchema>;

const sendMessageResponseSchema = z.object({
  success: z.boolean(),
  messageId: z.string().optional(),
});
type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>;

export const emailProviderDocSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  organizationId: z.string(),
  name: z.string(),
  vendor: emailProviderVendorSchema,
  authMethod: emailProviderAuthMethodSchema,
  sendMethod: sendMethodSchema.optional(),
  passwordAuth: passwordAuthEncryptedSchema.optional(),
  oauth2Auth: oauth2AuthStoredSchema.optional(),
  smtpConfig: smtpConfigSchema.optional(),
  imapConfig: imapConfigSchema.optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean(),
  status: emailProviderStatusSchema.optional(),
  lastTestedAt: z.number().optional(),
  lastSyncAt: z.number().optional(),
  errorMessage: z.string().optional(),
  metadata: jsonRecordSchema.optional(),
});
type EmailProviderDoc = z.infer<typeof emailProviderDocSchema>;
