import { zodToConvex } from 'convex-helpers/server/zod3';
import {
	emailProviderVendorSchema,
	emailProviderAuthMethodSchema,
	emailProviderStatusSchema,
	sendMethodSchema,
	accountTypeSchema,
	smtpConfigSchema,
	imapConfigSchema,
	passwordAuthSchema,
	passwordAuthEncryptedSchema,
	oauth2AuthInputSchema,
	oauth2AuthStoredSchema,
	oauth2AuthSimpleSchema,
	connectionTestItemSchema,
	connectionTestResultSchema,
	oauth2CallbackResponseSchema,
	sendMessageResponseSchema,
	emailProviderDocSchema,
} from '../../../lib/shared/validators/email_providers';

export * from '../common/validators';
export * from '../../../lib/shared/validators/email_providers';

export const emailProviderVendorValidator = zodToConvex(emailProviderVendorSchema);
export const emailProviderAuthMethodValidator = zodToConvex(emailProviderAuthMethodSchema);
export const emailProviderStatusValidator = zodToConvex(emailProviderStatusSchema);
export const sendMethodValidator = zodToConvex(sendMethodSchema);
export const accountTypeValidator = zodToConvex(accountTypeSchema);
export const smtpConfigValidator = zodToConvex(smtpConfigSchema);
export const imapConfigValidator = zodToConvex(imapConfigSchema);
export const passwordAuthValidator = zodToConvex(passwordAuthSchema);
export const passwordAuthEncryptedValidator = zodToConvex(passwordAuthEncryptedSchema);
export const oauth2AuthInputValidator = zodToConvex(oauth2AuthInputSchema);
export const oauth2AuthStoredValidator = zodToConvex(oauth2AuthStoredSchema);
export const oauth2AuthSimpleValidator = zodToConvex(oauth2AuthSimpleSchema);
export const connectionTestItemValidator = zodToConvex(connectionTestItemSchema);
export const connectionTestResultValidator = zodToConvex(connectionTestResultSchema);
export const oauth2CallbackResponseValidator = zodToConvex(oauth2CallbackResponseSchema);
export const sendMessageResponseValidator = zodToConvex(sendMessageResponseSchema);
export const emailProviderDocValidator = zodToConvex(emailProviderDocSchema);
