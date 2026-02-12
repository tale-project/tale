import type { Doc } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

interface CreateOAuth2ProviderArgs {
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
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  credentialsSource?: 'sso' | 'manual';
}

interface CreateOAuth2ProviderDependencies {
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
 * Get OAuth2 credentials from overrides or environment variables
 */
function getOAuth2Credentials(
  provider: 'gmail' | 'microsoft',
  overrides?: { clientId?: string; clientSecret?: string },
): {
  clientId: string;
  clientSecret: string;
} {
  // Microsoft requires user-provided credentials (no env var fallback)
  if (provider === 'microsoft') {
    if (!overrides?.clientId || !overrides?.clientSecret) {
      throw new Error(
        'Missing Microsoft OAuth2 credentials. Please provide your Azure AD Client ID and Client Secret.',
      );
    }
    return {
      clientId: overrides.clientId,
      clientSecret: overrides.clientSecret,
    };
  }

  // Gmail: use overrides if provided, otherwise fall back to env vars
  if (overrides?.clientId && overrides?.clientSecret) {
    return {
      clientId: overrides.clientId,
      clientSecret: overrides.clientSecret,
    };
  }

  if (provider === 'gmail') {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        'Missing Google OAuth2 credentials. Please provide Client ID and Client Secret, or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
      );
    }

    return { clientId, clientSecret };
  }

  const _exhaustiveCheck: never = provider;
  throw new Error(`Unsupported OAuth2 provider: ${String(_exhaustiveCheck)}`);
}

/**
 * Create OAuth2 email provider with server-side credentials
 * Fetches OAuth2 credentials from overrides or environment variables and encrypts them
 */
export async function createOAuth2Provider(
  _ctx: ActionCtx,
  args: CreateOAuth2ProviderArgs,
  deps: CreateOAuth2ProviderDependencies,
): Promise<Doc<'emailProviders'>['_id']> {
  // Get OAuth2 credentials from overrides or environment variables
  const { clientId, clientSecret } = getOAuth2Credentials(args.provider, {
    clientId: args.clientId,
    clientSecret: args.clientSecret,
  });

  // Encrypt client secret
  let clientSecretEncrypted: string;
  try {
    clientSecretEncrypted = await deps.encryptString(clientSecret);
  } catch (error) {
    console.error('Failed to encrypt OAuth2 client secret:', error);
    throw new Error(
      'Failed to encrypt OAuth2 credentials. Please ensure ENCRYPTION_SECRET is set in your Convex environment variables (Dashboard → Settings → Environment Variables). Error: ' +
        (error instanceof Error ? error.message : 'Unknown error'),
      { cause: error },
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
  if (args.tenantId) {
    metadata.tenantId = args.tenantId;
  }
  if (args.credentialsSource) {
    metadata.credentialsSource = args.credentialsSource;
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
