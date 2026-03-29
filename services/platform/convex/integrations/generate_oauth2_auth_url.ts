/**
 * Generate OAuth2 authorization URL for an integration.
 *
 * Reads the credential record + file config to build an OAuth2 authorization
 * URL with a state parameter for CSRF protection.
 */

import type { Doc } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

import { internal } from '../_generated/api';
import { createDebugLog } from '../lib/debug_log';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations OAuth2]');

function isGoogleAuthUrl(authorizationUrl: string) {
  return authorizationUrl.includes('accounts.google.com');
}

function isMicrosoftAuthUrl(authorizationUrl: string) {
  return authorizationUrl.includes('login.microsoftonline.com');
}

function applyProviderAuthParams(
  authorizationUrl: string,
  params: URLSearchParams,
  scopes: string[],
) {
  if (isGoogleAuthUrl(authorizationUrl)) {
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
  } else if (isMicrosoftAuthUrl(authorizationUrl)) {
    if (!scopes.includes('offline_access')) {
      scopes.push('offline_access');
    }
    params.set('prompt', 'select_account');
  }
}

interface GenerateOAuth2AuthUrlArgs {
  credentialId: Doc<'integrationCredentials'>['_id'];
  organizationId: string;
}

export async function generateOAuth2AuthUrl(
  ctx: ActionCtx,
  args: GenerateOAuth2AuthUrlArgs,
): Promise<string> {
  const credential = await ctx.runQuery(
    internal.integrations.credential_queries.getByIdInternal,
    { credentialId: args.credentialId },
  );

  if (!credential) {
    throw new Error('Integration credential not found');
  }

  const fileResult = await ctx.runAction(
    internal.integrations.file_actions.readIntegrationForExecution,
    { orgSlug: 'default', slug: credential.slug },
  );

  if (!fileResult?.ok) {
    throw new Error(
      'Integration file config not found for slug: ' + credential.slug,
    );
  }

  const fileOAuth2Config = fileResult.config?.oauth2Config;
  const dbOAuth2Config = credential.oauth2Config;

  const authorizationUrl =
    fileOAuth2Config?.authorizationUrl ?? dbOAuth2Config?.authorizationUrl;
  const clientId = dbOAuth2Config?.clientId;
  const configScopes = fileOAuth2Config?.scopes ?? dbOAuth2Config?.scopes;

  if (!authorizationUrl) {
    throw new Error(
      'Integration does not have OAuth2 configuration. ' +
        'Ensure the integration package includes oauth2Config.',
    );
  }

  if (!clientId) {
    throw new Error(
      'Please save your Client ID before starting authorization.',
    );
  }

  const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
  const basePath = process.env.BASE_PATH || '';
  const redirectUri = `${siteUrl}${basePath}/api/integrations/oauth2/callback`;

  const state = btoa(
    JSON.stringify({
      prefix: 'integration',
      credentialId: args.credentialId,
      organizationId: args.organizationId,
    }),
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });

  const scopes = configScopes ? [...configScopes] : [];

  applyProviderAuthParams(authorizationUrl, params, scopes);

  if (scopes.length > 0) {
    params.set('scope', scopes.join(' '));
  }

  const authUrl = `${authorizationUrl}?${params.toString()}`;

  debugLog('Generated OAuth2 authorization URL', {
    credentialId: args.credentialId,
    redirectUri,
    clientId: clientId.slice(0, 10) + '...',
  });

  return authUrl;
}
