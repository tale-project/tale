/**
 * Internal function to create an email provider
 */

import type { MutationCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import type {
  EmailProviderVendor,
  EmailProviderAuthMethod,
  SmtpConfig,
  ImapConfig,
} from './types';

export interface CreateProviderInternalArgs {
  organizationId: string;
  name: string;
  vendor: EmailProviderVendor;
  authMethod: EmailProviderAuthMethod;
  sendMethod?: 'smtp' | 'api';
  passwordAuth?: {
    user: string;
    passEncrypted: string;
  };
  oauth2Auth?: {
    provider: string;
    clientId: string;
    clientSecretEncrypted: string;
    accessTokenEncrypted?: string;
    refreshTokenEncrypted?: string;
    tokenExpiry?: number;
    tokenUrl?: string;
  };
  smtpConfig?: SmtpConfig;
  imapConfig?: ImapConfig;
  isDefault: boolean;
  metadata?: unknown;
}

export async function createProviderInternal(
  ctx: MutationCtx,
  args: CreateProviderInternalArgs,
): Promise<Doc<'emailProviders'>['_id']> {
  // Check if there are any existing default providers
  const existingDefaults = await ctx.db
    .query('emailProviders')
    .withIndex('by_organizationId_and_isDefault', (q) =>
      q.eq('organizationId', args.organizationId).eq('isDefault', true),
    )
    .collect();

  // Determine if this should be the default provider
  let isDefault = args.isDefault;

  // If no existing default provider exists, automatically set this as default
  if (existingDefaults.length === 0) {
    isDefault = true;
  }

  // If this is set as default, unset other defaults
  if (isDefault && existingDefaults.length > 0) {
    for (const provider of existingDefaults) {
      await ctx.db.patch(provider._id, { isDefault: false });
    }
  }

  const providerId = await ctx.db.insert('emailProviders', {
    organizationId: args.organizationId,
    name: args.name,
    vendor: args.vendor,
    authMethod: args.authMethod,
    sendMethod: args.sendMethod,
    passwordAuth: args.passwordAuth,
    oauth2Auth: args.oauth2Auth as any,
    smtpConfig: args.smtpConfig,
    imapConfig: args.imapConfig,
    isDefault: isDefault,
    status: 'active',
    metadata: args.metadata,
  });

  return providerId;
}
