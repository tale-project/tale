/**
 * Generate OAuth2 authorization URL for an integration.
 *
 * Reads the integration's oauth2Config (authorizationUrl, clientId, scopes)
 * and builds a redirect URL with a state parameter for CSRF protection.
 */

import type { Doc } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

import { api } from '../_generated/api';
import { createDebugLog } from '../lib/debug_log';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations OAuth2]');

interface GenerateOAuth2AuthUrlArgs {
  integrationId: Doc<'integrations'>['_id'];
  organizationId: string;
}

export async function generateOAuth2AuthUrl(
  ctx: ActionCtx,
  args: GenerateOAuth2AuthUrlArgs,
): Promise<string> {
  const integration = await ctx.runQuery(api.integrations.queries.get, {
    integrationId: args.integrationId,
  });

  if (!integration) {
    throw new Error('Integration not found');
  }

  const oauth2Config = integration.oauth2Config;
  if (!oauth2Config) {
    throw new Error(
      'Integration does not have OAuth2 configuration. ' +
        'Ensure the integration package includes oauth2Config.',
    );
  }

  if (!oauth2Config.clientId) {
    throw new Error(
      'Please save your Client ID before starting authorization.',
    );
  }

  const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
  const redirectUri = `${siteUrl}/api/integrations/oauth2/callback`;

  const state = `integration:${args.integrationId}:${args.organizationId}`;

  const params = new URLSearchParams({
    client_id: oauth2Config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });

  if (oauth2Config.scopes && oauth2Config.scopes.length > 0) {
    params.set('scope', oauth2Config.scopes.join(' '));
  }

  // Request offline access to get a refresh token
  params.set('access_type', 'offline');
  params.set('prompt', 'consent');

  const authUrl = `${oauth2Config.authorizationUrl}?${params.toString()}`;

  debugLog('Generated OAuth2 authorization URL', {
    integrationId: args.integrationId,
    redirectUri,
    clientId: oauth2Config.clientId.slice(0, 10) + '...',
  });

  return authUrl;
}
