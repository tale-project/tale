/**
 * Business logic for creating OAuth2 email providers with server-side credentials
 */

import type { ActionCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import { saveRelatedWorkflows } from './save_related_workflows';

export interface CreateOAuth2ProviderArgs {
  organizationId: string;
  name: string;
  vendor: 'gmail' | 'outlook';
  provider: 'gmail' | 'microsoft';
  sendMethod?: 'smtp' | 'api';
  smtpConfig?: {
    host: string;
    port: number;
    secure: boolean;
  };
  imapConfig?: {
    host: string;
    port: number;
    secure: boolean;
  };
  isDefault: boolean;
  accountType?: 'personal' | 'organizational' | 'both';
}

export interface CreateOAuth2ProviderDependencies {
  encryptString: (plaintext: string) => Promise<string>;
  createInternal: (params: {
    organizationId: string;
    name: string;
    vendor: string;
    authMethod: string;
    sendMethod?: 'smtp' | 'api';
    oauth2Auth: {
      provider: string;
      clientId: string;
      clientSecretEncrypted: string;
    };
    smtpConfig?: {
      host: string;
      port: number;
      secure: boolean;
    };
    imapConfig?: {
      host: string;
      port: number;
      secure: boolean;
    };
    isDefault: boolean;
    metadata?: unknown;
  }) => Promise<Doc<'emailProviders'>['_id']>;
}

/**
 * Get OAuth2 credentials from environment variables
 */
function getOAuth2Credentials(provider: 'gmail' | 'microsoft'): {
  clientId: string;
  clientSecret: string;
} {
  if (provider === 'gmail') {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        'Missing Google OAuth2 credentials. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
      );
    }

    return { clientId, clientSecret };
  } else if (provider === 'microsoft') {
    const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
    const clientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        'Missing Microsoft OAuth2 credentials. Please set AUTH_MICROSOFT_ENTRA_ID_ID and AUTH_MICROSOFT_ENTRA_ID_SECRET environment variables.',
      );
    }

    return { clientId, clientSecret };
  }

  throw new Error(`Unsupported OAuth2 provider: ${provider}`);
}

/**
 * Main logic for creating OAuth2 email provider with server-side credentials
 * Fetches OAuth2 credentials from environment variables and encrypts them
 */
export async function createOAuth2ProviderLogic(
  ctx: ActionCtx,
  args: CreateOAuth2ProviderArgs,
  deps: CreateOAuth2ProviderDependencies,
): Promise<Doc<'emailProviders'>['_id']> {
  // Get OAuth2 credentials from environment variables
  const { clientId, clientSecret } = getOAuth2Credentials(args.provider);

  // Encrypt client secret
  let clientSecretEncrypted: string;
  try {
    clientSecretEncrypted = await deps.encryptString(clientSecret);
  } catch (error) {
    console.error('Failed to encrypt OAuth2 client secret:', error);
    throw new Error(
      'Failed to encrypt OAuth2 credentials. Please ensure ENCRYPTION_SECRET is set in your Convex environment variables (Dashboard → Settings → Environment Variables). Error: ' +
        (error instanceof Error ? error.message : 'Unknown error'),
    );
  }

  // Build OAuth2 auth config
  const oauth2Auth = {
    provider: args.provider,
    clientId,
    clientSecretEncrypted,
  };

  // Build metadata
  const metadata: Record<string, unknown> = {};
  if (args.accountType) {
    metadata.accountType = args.accountType;
  }

  // Call internal mutation to insert the provider
  const providerId = await deps.createInternal({
    organizationId: args.organizationId,
    name: args.name,
    vendor: args.vendor,
    authMethod: 'oauth2',
    sendMethod: args.sendMethod,
    oauth2Auth,
    smtpConfig: args.smtpConfig,
    imapConfig: args.imapConfig,
    isDefault: args.isDefault,
    metadata,
  });

  return providerId;
}
