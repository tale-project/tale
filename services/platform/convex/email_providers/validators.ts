/**
 * Convex validators for email provider operations
 * Generated from shared Zod schemas using zodToConvex
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  emailProviderVendorSchema,
  emailProviderAuthMethodSchema,
  emailProviderStatusSchema,
  sendMethodSchema,
  smtpConfigSchema,
  imapConfigSchema,
  passwordAuthSchema,
  passwordAuthEncryptedSchema,
  oauth2AuthStoredSchema,
  connectionTestResultSchema,
  emailProviderDocSchema,
} from '../../lib/shared/schemas/email_providers';

export {
  emailProviderVendorSchema,
  emailProviderAuthMethodSchema,
  emailProviderStatusSchema,
  sendMethodSchema,
  smtpConfigSchema,
  imapConfigSchema,
  emailProviderDocSchema,
} from '../../lib/shared/schemas/email_providers';

export const emailProviderVendorValidator = zodToConvex(emailProviderVendorSchema);
export const emailProviderAuthMethodValidator = zodToConvex(emailProviderAuthMethodSchema);
export const emailProviderStatusValidator = zodToConvex(emailProviderStatusSchema);
export const sendMethodValidator = zodToConvex(sendMethodSchema);
export const smtpConfigValidator = zodToConvex(smtpConfigSchema);
export const imapConfigValidator = zodToConvex(imapConfigSchema);
export const passwordAuthValidator = zodToConvex(passwordAuthSchema);
export const passwordAuthEncryptedValidator = zodToConvex(passwordAuthEncryptedSchema);
export const oauth2AuthStoredValidator = zodToConvex(oauth2AuthStoredSchema);
export const connectionTestResultValidator = zodToConvex(connectionTestResultSchema);
export const emailProviderDocValidator = zodToConvex(emailProviderDocSchema);
