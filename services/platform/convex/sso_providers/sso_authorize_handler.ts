import { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { decryptString } from '../lib/crypto/decrypt_string';

const MICROSOFT_AUTHORIZE_URL = 'https://login.microsoftonline.com';

const ONEDRIVE_SCOPES = [
  'https://graph.microsoft.com/Files.Read',
  'https://graph.microsoft.com/Sites.Read.All',
  'offline_access',
];

function normalizeOrigin(origin: string): string {
  return origin.replace('127.0.0.1', 'localhost');
}

export async function ssoAuthorizeHandler(ctx: ActionCtx, req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const email = url.searchParams.get('email');
    const normalizedOrigin = normalizeOrigin(url.origin);
    const redirectUri = url.searchParams.get('redirect_uri') || `${normalizedOrigin}/api/sso/callback`;

    const provider = await ctx.runQuery(internal.sso_providers.internal_queries.getSsoConfig, {});

    if (!provider) {
      return new Response('No SSO configuration found', { status: 404 });
    }

    const loginHint = email || undefined;

    const clientId = await decryptString(provider.clientIdEncrypted);

    const stateData = JSON.stringify({
      redirectUri,
      timestamp: Date.now(),
    });
    const state = btoa(stateData).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const tenantId = provider.issuer.includes('login.microsoftonline.com')
      ? provider.issuer.split('/')[3] || 'common'
      : 'common';

    const scopes = [...provider.scopes];
    if (provider.enableOneDriveAccess) {
      for (const scope of ONEDRIVE_SCOPES) {
        if (!scopes.includes(scope)) {
          scopes.push(scope);
        }
      }
    }

    const authUrl = new URL(`${MICROSOFT_AUTHORIZE_URL}/${tenantId}/oauth2/v2.0/authorize`);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', scopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_mode', 'query');

    if (loginHint) {
      authUrl.searchParams.set('login_hint', loginHint);
    }

    return new Response(null, {
      status: 302,
      headers: { Location: authUrl.toString() },
    });
  } catch (error) {
    console.error('[SSO] Authorize error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
