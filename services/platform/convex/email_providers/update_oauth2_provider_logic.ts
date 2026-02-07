import type { Doc } from '../_generated/dataModel';

interface UpdateOAuth2ProviderArgs {
  providerId: Doc<'emailProviders'>['_id'];
  name?: string;
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
  sendMethod?: 'smtp' | 'api';
  credentialsSource?: 'sso' | 'manual';
}

interface UpdateOAuth2ProviderDependencies {
  encryptString: (plaintext: string) => Promise<string>;
  getProvider: (
    providerId: Doc<'emailProviders'>['_id'],
  ) => Promise<Doc<'emailProviders'> | null>;
  updateInternal: (params: {
    providerId: Doc<'emailProviders'>['_id'];
    name?: string;
    oauth2Auth?: {
      provider: string;
      clientId: string;
      clientSecretEncrypted: string;
    };
    sendMethod?: 'smtp' | 'api';
    smtpConfig?: {
      host: string;
      port: number;
      secure: boolean;
    };
    metadata?: Record<string, unknown>;
    status?: 'active' | 'error' | 'testing' | 'pending_authorization';
  }) => Promise<null>;
}

export async function updateOAuth2ProviderLogic(
  args: UpdateOAuth2ProviderArgs,
  deps: UpdateOAuth2ProviderDependencies,
): Promise<null> {
  const provider = await deps.getProvider(args.providerId);
  if (!provider) {
    throw new Error('Email provider not found');
  }

  if (provider.authMethod !== 'oauth2') {
    throw new Error('This provider does not use OAuth2 authentication');
  }

  const updateParams: Parameters<typeof deps.updateInternal>[0] = {
    providerId: args.providerId,
  };

  if (args.name !== undefined) {
    updateParams.name = args.name;
  }

  if (args.sendMethod !== undefined) {
    updateParams.sendMethod = args.sendMethod;
    if (args.sendMethod === 'smtp' && provider.vendor === 'outlook') {
      updateParams.smtpConfig = {
        host: 'smtp.office365.com',
        port: 587,
        secure: false,
      };
    } else if (args.sendMethod === 'smtp' && provider.vendor === 'gmail') {
      updateParams.smtpConfig = {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
      };
    }
  }

  // Update OAuth2 credentials if provided
  if (args.clientId !== undefined || args.clientSecret !== undefined) {
    const currentOAuth2 = provider.oauth2Auth;
    if (!currentOAuth2) {
      throw new Error('Provider OAuth2 configuration not found');
    }

    const newClientId = args.clientId ?? currentOAuth2.clientId;

    // Only encrypt new secret if provided, otherwise keep existing
    let newClientSecretEncrypted = currentOAuth2.clientSecretEncrypted;
    if (args.clientSecret) {
      try {
        newClientSecretEncrypted = await deps.encryptString(args.clientSecret);
      } catch (error) {
        console.error('Failed to encrypt OAuth2 client secret:', error);
        throw new Error('Failed to encrypt OAuth2 credentials');
      }
    }

    updateParams.oauth2Auth = {
      provider: currentOAuth2.provider,
      clientId: newClientId,
      clientSecretEncrypted: newClientSecretEncrypted,
    };

    // Credentials changed, reset status to pending_authorization
    updateParams.status = 'pending_authorization';
  }

  // Update metadata if tenantId or credentialsSource provided
  if (args.tenantId !== undefined || args.credentialsSource !== undefined) {
    const rawMetadata = provider.metadata;
    const currentMetadata =
      typeof rawMetadata === 'object' && rawMetadata !== null && !Array.isArray(rawMetadata)
        ? (rawMetadata as Record<string, unknown>)
        : {};
    updateParams.metadata = {
      ...currentMetadata,
      ...(args.tenantId !== undefined && { tenantId: args.tenantId || undefined }),
      ...(args.credentialsSource !== undefined && { credentialsSource: args.credentialsSource }),
    };
  }

  await deps.updateInternal(updateParams);
  return null;
}
