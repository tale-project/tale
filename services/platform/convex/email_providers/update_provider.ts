import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { SmtpConfig, ImapConfig, EmailProviderStatus } from './types';

interface UpdateProviderArgs {
  providerId: Doc<'emailProviders'>['_id'];
  name?: string;
  isDefault?: boolean;
  sendMethod?: 'smtp' | 'api';
  oauth2Auth?: {
    provider: string;
    clientId: string;
    clientSecretEncrypted: string;
  };
  smtpConfig?: SmtpConfig;
  imapConfig?: ImapConfig;
  status?: EmailProviderStatus;
  lastTestedAt?: number;
  lastSyncAt?: number;
  errorMessage?: string;
  metadata?: unknown;
}

export async function updateProvider(
  ctx: MutationCtx,
  args: UpdateProviderArgs,
): Promise<null> {
  const { providerId } = args;

  const provider = await ctx.db.get(providerId);
  if (!provider) {
    throw new Error('Email provider not found');
  }

  if (args.isDefault) {
    const providerIdsToUnset: Array<Doc<'emailProviders'>['_id']> = [];
    for await (const existingProvider of ctx.db
      .query('emailProviders')
      .withIndex('by_organizationId_and_isDefault', (q) =>
        q.eq('organizationId', provider.organizationId).eq('isDefault', true),
      )) {
      if (existingProvider._id !== providerId) {
        providerIdsToUnset.push(existingProvider._id);
      }
    }
    await Promise.all(
      providerIdsToUnset.map((id) => ctx.db.patch(id, { isDefault: false })),
    );
  }

  const updateData: Partial<Doc<'emailProviders'>> = {};
  if (args.name !== undefined) updateData.name = args.name;
  if (args.isDefault !== undefined) updateData.isDefault = args.isDefault;
  if (args.sendMethod !== undefined) updateData.sendMethod = args.sendMethod;
  if (args.oauth2Auth !== undefined) updateData.oauth2Auth = args.oauth2Auth;
  if (args.smtpConfig !== undefined) updateData.smtpConfig = args.smtpConfig;
  if (args.imapConfig !== undefined) updateData.imapConfig = args.imapConfig;
  if (args.status !== undefined) updateData.status = args.status;
  if (args.lastTestedAt !== undefined)
    updateData.lastTestedAt = args.lastTestedAt;
  if (args.lastSyncAt !== undefined) updateData.lastSyncAt = args.lastSyncAt;
  if (args.errorMessage !== undefined)
    updateData.errorMessage = args.errorMessage;
  if (args.metadata !== undefined) {
    updateData.metadata = {
      ...provider.metadata,
      ...args.metadata,
    };
  }

  await ctx.db.patch(providerId, updateData);
  return null;
}
