/**
 * Generate OAuth2 authorization URL
 */

import type { Doc } from '../../_generated/dataModel';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_OAUTH2', '[OAuth2]');

export interface OAuth2UrlConfig {
  provider: string;
  clientId: string;
  emailProviderId: Doc<'emailProviders'>['_id'];
  organizationId: string;
  accountType?: 'personal' | 'organizational' | 'both';
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
): OAuth2ProviderConfig {
  if (provider === 'gmail') {
    return {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      scope: ['https://mail.google.com/'],
    };
  } else if (provider === 'microsoft') {
    const tenantType =
      accountType === 'personal'
        ? 'consumers'
        : accountType === 'organizational'
          ? 'organizations'
          : 'common';
    return {
      authUrl: `https://login.microsoftonline.com/${tenantType}/oauth2/v2.0/authorize`,
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
    clientId: config.clientId.substring(0, 10) + '...',
    scope: providerConfig.scope.join(' '),
  });

  return `${providerConfig.authUrl}?${params.toString()}`;
}
