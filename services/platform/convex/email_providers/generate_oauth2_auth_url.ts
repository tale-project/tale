/**
 * Generate OAuth2 authorization URL for an email provider
 */

import type { Doc } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

import { createDebugLog } from '../lib/debug_log';

const debugLog = createDebugLog('DEBUG_OAUTH2', '[OAuth2]');

export interface OAuth2UrlConfig {
  provider: string;
  clientId: string;
  emailProviderId: Doc<'emailProviders'>['_id'];
  organizationId: string;
  accountType?: 'personal' | 'organizational' | 'both';
  tenantId?: string;
  redirectUri?: string;
}

interface OAuth2ProviderConfig {
  authUrl: string;
  scope: string[];
}

/**
 * Get OAuth2 provider configuration (auth URL and scopes)
 */
export function getOAuth2ProviderConfig(
  provider: string,
  accountType?: 'personal' | 'organizational' | 'both',
  tenantId?: string,
): OAuth2ProviderConfig {
  if (provider === 'gmail') {
    return {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      scope: ['https://mail.google.com/'],
    };
  } else if (provider === 'microsoft') {
    // Use tenant ID if provided (for single-tenant apps), otherwise use account type
    let tenant = 'common';
    if (tenantId) {
      tenant = tenantId;
    } else if (accountType === 'personal') {
      tenant = 'consumers';
    } else if (accountType === 'organizational') {
      tenant = 'organizations';
    }
    return {
      authUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      scope: [
        'https://outlook.office.com/SMTP.Send',
        'https://outlook.office.com/IMAP.AccessAsUser.All',
        'https://graph.microsoft.com/User.Read',
        'https://graph.microsoft.com/Mail.ReadWrite',
        'https://graph.microsoft.com/Mail.Send',
        'offline_access',
      ],
    };
  } else {
    throw new Error(`Unsupported OAuth2 provider: ${provider}`);
  }
}

/**
 * Build OAuth2 authorization URL
 */
export function buildOAuth2AuthUrl(config: OAuth2UrlConfig): string {
  const providerConfig = getOAuth2ProviderConfig(
    config.provider,
    config.accountType,
    config.tenantId,
  );

  // Build redirect URI (derive from SITE_URL)
  const redirectUri =
    config.redirectUri ||
    `${process.env.SITE_URL || 'http://localhost:3000'}/api/auth/oauth2/callback`;

  // Build state parameter: "provider:emailProviderId:organizationId"
  const state = `${config.provider}:${config.emailProviderId}:${config.organizationId}`;

  // Build authorization URL
  const params: URLSearchParams = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: providerConfig.scope.join(' '),
    state,
  });

  // For Gmail, explicitly request offline access and forced consent
  // to ensure a refresh token is issued.
  // For Microsoft, force account selection to allow users to choose
  // which account to use instead of auto-selecting cached credentials.
  if (config.provider === 'gmail') {
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
  } else if (config.provider === 'microsoft') {
    params.set('prompt', 'select_account');
  }

  debugLog('Generated OAuth2 authorization URL', {
    provider: config.provider,
    redirectUri,
    clientId: config.clientId.slice(0, 10) + '...',
    scope: providerConfig.scope.join(' '),
  });

  return `${providerConfig.authUrl}?${params.toString()}`;
}

interface GenerateOAuth2AuthUrlArgs {
  emailProviderId: Doc<'emailProviders'>['_id'];
  organizationId: string;
  redirectUri?: string;
}

interface GenerateOAuth2AuthUrlDependencies {
  getProvider: (providerId: Doc<'emailProviders'>['_id']) => Promise<unknown>;
  setMetadata: (
    providerId: Doc<'emailProviders'>['_id'],
    config: Record<string, string | number | boolean>,
  ) => Promise<void>;
}

/**
 * Fetches provider and builds authorization URL
 */
export async function generateOAuth2AuthUrl(
  ctx: ActionCtx,
  args: GenerateOAuth2AuthUrlArgs,
  deps: GenerateOAuth2AuthUrlDependencies,
): Promise<string> {
  // Get the provider
  const provider = await deps.getProvider(args.emailProviderId);

  if (!provider) {
    throw new Error('Provider not found');
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
  const providerData = provider as {
    authMethod: string;
    oauth2Auth?: { provider: string; clientId: string };
    metadata?: Record<string, unknown>;
  };

  if (providerData.authMethod !== 'oauth2' || !providerData.oauth2Auth) {
    throw new Error('Provider is not configured for OAuth2');
  }

  // Get OAuth2 config
  const oauth2Auth = providerData.oauth2Auth;
  const metadata = providerData.metadata;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
  const accountType = metadata?.accountType as
    | 'personal'
    | 'organizational'
    | 'both'
    | undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
  const tenantId = metadata?.tenantId as string | undefined;

  // Build and return OAuth2 authorization URL
  // Use redirectUri from args (passed from client) if available,
  // otherwise fall back to metadata, then to default
  debugLog('Received redirectUri from client:', args.redirectUri);
  debugLog('Metadata redirectUri:', metadata?.redirectUri);

  const finalRedirectUri =
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
    args.redirectUri || (metadata?.redirectUri as string | undefined);
  debugLog('Final redirectUri to use:', finalRedirectUri);

  // Persist the redirectUri/origin for use during the callback (when Host may be 0.0.0.0)
  if (finalRedirectUri) {
    try {
      const origin = new URL(finalRedirectUri).origin;
      await deps.setMetadata(args.emailProviderId, {
        redirectUri: finalRedirectUri,
        redirectOrigin: origin,
        redirectUpdatedAt: Date.now(),
      });
    } catch (e) {
      console.warn('[OAuth2 Server] Failed to persist redirectUri metadata', e);
    }
  }

  return buildOAuth2AuthUrl({
    provider: oauth2Auth.provider,
    clientId: oauth2Auth.clientId,
    emailProviderId: args.emailProviderId,
    organizationId: args.organizationId,
    accountType,
    tenantId,
    redirectUri: finalRedirectUri,
  });
}
