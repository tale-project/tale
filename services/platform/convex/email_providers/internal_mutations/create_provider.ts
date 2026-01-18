/**
 * Internal mutation to create an email provider
 */

import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import {
  emailProviderVendorValidator,
  emailProviderAuthMethodValidator,
  sendMethodValidator,
  smtpConfigValidator,
  imapConfigValidator,
  passwordAuthEncryptedValidator,
  oauth2AuthStoredValidator,
} from '../validators';
import { jsonRecordValidator } from '../../../lib/shared/schemas/utils/json-value';
import { createProviderInternal } from '../create_provider_internal';

export const createProvider = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    vendor: emailProviderVendorValidator,
    authMethod: emailProviderAuthMethodValidator,
    sendMethod: v.optional(sendMethodValidator),
    passwordAuth: v.optional(passwordAuthEncryptedValidator),
    oauth2Auth: v.optional(oauth2AuthStoredValidator),
    smtpConfig: v.optional(smtpConfigValidator),
    imapConfig: v.optional(imapConfigValidator),
    isDefault: v.boolean(),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    return await createProviderInternal(ctx, args);
  },
});
