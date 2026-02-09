/**
 * Internal function to create an email provider
 */

import type { ConvexJsonRecord } from '../../lib/shared/schemas/utils/json-value';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type {
  EmailProviderVendor,
  EmailProviderAuthMethod,
  SmtpConfig,
  ImapConfig,
} from './types';

interface CreateProviderInternalArgs {
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
  const existingDefault = await ctx.db
    .query('emailProviders')
    .withIndex('by_organizationId_and_isDefault', (q) =>
      q.eq('organizationId', args.organizationId).eq('isDefault', true),
    )
    .first();

  // Determine if this should be the default provider
  let isDefault = args.isDefault;

  // If no existing default provider exists, automatically set this as default
  if (existingDefault === null) {
    isDefault = true;
  }

  // If this is set as default, unset other defaults in parallel
  if (isDefault && existingDefault !== null) {
    const providerIdsToUnset: Array<Doc<'emailProviders'>['_id']> = [];
    for await (const provider of ctx.db
      .query('emailProviders')
      .withIndex('by_organizationId_and_isDefault', (q) =>
        q.eq('organizationId', args.organizationId).eq('isDefault', true),
      )) {
      providerIdsToUnset.push(provider._id);
    }
    await Promise.all(
      providerIdsToUnset.map((id) => ctx.db.patch(id, { isDefault: false })),
    );
  }

  // Type assertion not needed - interface matches Doc<'emailProviders'>['oauth2Auth']
  const oauth2Auth: Doc<'emailProviders'>['oauth2Auth'] = args.oauth2Auth;

  // Determine initial status:
  // - OAuth providers without tokens: pending_authorization
  // - Password providers or OAuth with tokens: active
  const initialStatus =
    args.authMethod === 'oauth2' && !args.oauth2Auth?.accessTokenEncrypted
      ? 'pending_authorization'
      : 'active';

  const providerId = await ctx.db.insert('emailProviders', {
    organizationId: args.organizationId,
    name: args.name,
    vendor: args.vendor,
    authMethod: args.authMethod,
    sendMethod: args.sendMethod,
    passwordAuth: args.passwordAuth,
    oauth2Auth,
    smtpConfig: args.smtpConfig,
    imapConfig: args.imapConfig,
    isDefault: isDefault,
    status: initialStatus,
    metadata: args.metadata as ConvexJsonRecord,
  });

  return providerId;
}
