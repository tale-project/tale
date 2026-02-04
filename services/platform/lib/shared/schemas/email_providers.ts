import { z } from 'zod/v4';
import { jsonRecordSchema } from './utils/json-value';

export const emailProviderVendorLiterals = ['gmail', 'outlook', 'smtp', 'resend', 'other'] as const;
export const emailProviderVendorSchema = z.enum(emailProviderVendorLiterals);
export type EmailProviderVendor = z.infer<typeof emailProviderVendorSchema>;

export const emailProviderAuthMethodLiterals = ['password', 'oauth2'] as const;
export const emailProviderAuthMethodSchema = z.enum(emailProviderAuthMethodLiterals);
export type EmailProviderAuthMethod = z.infer<typeof emailProviderAuthMethodSchema>;

export const emailProviderStatusLiterals = ['active', 'error', 'testing', 'pending_authorization'] as const;
export const emailProviderStatusSchema = z.enum(emailProviderStatusLiterals);
export type EmailProviderStatus = z.infer<typeof emailProviderStatusSchema>;

export const sendMethodLiterals = ['smtp', 'api'] as const;
export const sendMethodSchema = z.enum(sendMethodLiterals);
export type SendMethod = z.infer<typeof sendMethodSchema>;

export const accountTypeLiterals = ['personal', 'organizational', 'both'] as const;
export const accountTypeSchema = z.enum(accountTypeLiterals);
export type AccountType = z.infer<typeof accountTypeSchema>;

export const smtpConfigSchema = z.object({
	host: z.string(),
	port: z.number(),
	secure: z.boolean(),
});
export type SmtpConfig = z.infer<typeof smtpConfigSchema>;

export const imapConfigSchema = z.object({
	host: z.string(),
	port: z.number(),
	secure: z.boolean(),
});
export type ImapConfig = z.infer<typeof imapConfigSchema>;

export const passwordAuthSchema = z.object({
	user: z.string(),
	pass: z.string(),
});
export type PasswordAuth = z.infer<typeof passwordAuthSchema>;

export const passwordAuthEncryptedSchema = z.object({
	user: z.string(),
	passEncrypted: z.string(),
});
export type PasswordAuthEncrypted = z.infer<typeof passwordAuthEncryptedSchema>;

export const oauth2AuthInputSchema = z.object({
	provider: z.string(),
	clientId: z.string(),
	clientSecret: z.string(),
	tokenUrl: z.string().optional(),
});
export type OAuth2AuthInput = z.infer<typeof oauth2AuthInputSchema>;

export const oauth2AuthStoredSchema = z.object({
	provider: z.string(),
	clientId: z.string(),
	clientSecretEncrypted: z.string(),
	accessTokenEncrypted: z.string().optional(),
	refreshTokenEncrypted: z.string().optional(),
	tokenExpiry: z.number().optional(),
	tokenUrl: z.string().optional(),
});
export type OAuth2AuthStored = z.infer<typeof oauth2AuthStoredSchema>;

export const oauth2AuthSimpleSchema = z.object({
	user: z.string(),
	accessToken: z.string(),
});
export type OAuth2AuthSimple = z.infer<typeof oauth2AuthSimpleSchema>;

export const connectionTestItemSchema = z.object({
	success: z.boolean(),
	latencyMs: z.number(),
	error: z.string().optional(),
});
export type ConnectionTestItem = z.infer<typeof connectionTestItemSchema>;

export const connectionTestResultSchema = z.object({
	success: z.boolean(),
	smtp: connectionTestItemSchema,
	imap: connectionTestItemSchema,
});
export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>;

export const oauth2CallbackResponseSchema = z.object({
	success: z.boolean(),
	userEmail: z.string().optional(),
	redirectUri: z.string().optional(),
	redirectOrigin: z.string().optional(),
});
export type OAuth2CallbackResponse = z.infer<typeof oauth2CallbackResponseSchema>;

export const sendMessageResponseSchema = z.object({
	success: z.boolean(),
	messageId: z.string().optional(),
});
export type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>;

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
export type EmailProviderDoc = z.infer<typeof emailProviderDocSchema>;
