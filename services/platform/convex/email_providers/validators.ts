import { v } from 'convex/values';
import { zodToConvex } from 'convex-helpers/server/zod4';
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
} from '../../lib/shared/schemas/email_providers';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

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

export const emailProviderDocValidator = v.object({
  _id: v.string(),
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
