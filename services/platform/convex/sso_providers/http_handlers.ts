/**
 * SSO HTTP Handlers
 *
 * HTTP endpoints for dynamic SSO authentication.
 * Supports per-organization Microsoft Entra ID configuration.
 */

import { httpAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { decryptString } from '../lib/crypto/decrypt_string';

// Type assertion to avoid TS2589 deep type instantiation errors
// @ts-ignore: TS2589 - deep type instantiation
const internalApi = internal as any;

const MICROSOFT_AUTHORIZE_URL = 'https://login.microsoftonline.com';
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com';
const MICROSOFT_USERINFO_URL = 'https://graph.microsoft.com/v1.0/me';

/**
 * SSO Discovery Endpoint
 *
 * Checks if a domain has SSO configured.
 * POST /api/sso/discover
 * Body: { email: string }
 */
export const ssoDiscoverHandler = httpAction(async (ctx, req) => {
  try {
    const body = await req.json();
    const email = body?.email;

    if (!email || typeof email !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) {
      return new Response(
        JSON.stringify({ error: 'Invalid email format' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const provider = await ctx.runQuery(internalApi.sso_providers.internal_queries.getSsoConfigByDomain, {
      domain,
    });

    if (!provider) {
      return new Response(
        JSON.stringify({ ssoEnabled: false }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({
        ssoEnabled: true,
        organizationId: provider.organizationId,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[SSO] Discover error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});

/**
 * SSO Authorize Endpoint
 *
 * Initiates OAuth flow. Supports two modes:
 * 1. Single-org mode: GET /api/sso/authorize (no params, uses first provider)
 * 2. Domain mode: GET /api/sso/authorize?email=user@example.com
 */
export const ssoAuthorizeHandler = httpAction(async (ctx, req) => {
  try {
    const url = new URL(req.url);
    const email = url.searchParams.get('email');
    const redirectUri = url.searchParams.get('redirect_uri') || `${url.origin}/api/sso/callback`;

    let provider;
    let domain: string;
    let loginHint: string | undefined;

    if (email) {
      // Domain-based lookup
      domain = email.split('@')[1]?.toLowerCase();
      if (!domain) {
        return new Response('Invalid email format', { status: 400 });
      }

      provider = await ctx.runQuery(internalApi.sso_providers.internal_queries.getFullSsoConfig, {
        domain,
      });

      if (!provider) {
        return new Response(`No SSO configuration found for domain: ${domain}`, { status: 404 });
      }

      loginHint = email;
    } else {
      // Single-org mode: use first available provider
      provider = await ctx.runQuery(internalApi.sso_providers.internal_queries.getFirstSsoProvider, {});

      if (!provider) {
        return new Response('No SSO configuration found', { status: 404 });
      }

      domain = provider.domain;
    }

    // Decrypt client ID
    const clientId = await decryptString(provider.clientIdEncrypted);

    // Build state parameter (contains domain for callback lookup)
    const state = Buffer.from(JSON.stringify({
      domain,
      redirectUri,
      timestamp: Date.now(),
    })).toString('base64url');

    // Determine tenant for authorization URL
    const tenantId = provider.issuer.includes('login.microsoftonline.com')
      ? provider.issuer.split('/')[3] || 'common'
      : 'common';

    // Build OAuth authorization URL
    const authUrl = new URL(`${MICROSOFT_AUTHORIZE_URL}/${tenantId}/oauth2/v2.0/authorize`);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', provider.scopes.join(' '));
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
});

/**
 * SSO Callback Endpoint
 *
 * Handles OAuth callback from Microsoft.
 * GET /api/sso/callback?code=...&state=...
 */
export const ssoCallbackHandler = httpAction(async (ctx, req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const stateParam = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');

    if (error) {
      console.error('[SSO] OAuth error:', error, errorDescription);
      return redirectWithError(url.origin, `SSO login failed: ${errorDescription || error}`);
    }

    if (!code || !stateParam) {
      return redirectWithError(url.origin, 'Missing authorization code or state');
    }

    // Decode state
    let state: { domain: string; redirectUri: string; timestamp: number };
    try {
      state = JSON.parse(Buffer.from(stateParam, 'base64url').toString());
    } catch {
      return redirectWithError(url.origin, 'Invalid state parameter');
    }

    // Check state timestamp (10 minute expiry)
    if (Date.now() - state.timestamp > 10 * 60 * 1000) {
      return redirectWithError(url.origin, 'SSO session expired');
    }

    // Get SSO config for this domain
    const provider = await ctx.runQuery(internalApi.sso_providers.internal_queries.getFullSsoConfig, {
      domain: state.domain,
    });

    if (!provider) {
      return redirectWithError(url.origin, 'SSO configuration not found');
    }

    // Decrypt credentials
    const clientId = await decryptString(provider.clientIdEncrypted);
    const clientSecret = await decryptString(provider.clientSecretEncrypted);

    // Determine tenant for token URL
    const tenantId = provider.issuer.includes('login.microsoftonline.com')
      ? provider.issuer.split('/')[3] || 'common'
      : 'common';

    // Exchange code for tokens
    const tokenResponse = await fetch(
      `${MICROSOFT_TOKEN_URL}/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: state.redirectUri,
          grant_type: 'authorization_code',
        }),
      },
    );

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[SSO] Token exchange failed:', errorText);
      return redirectWithError(url.origin, 'Failed to exchange authorization code');
    }

    const tokens = await tokenResponse.json();
    const accessToken = tokens.access_token;

    // Get user info from Microsoft Graph
    const userInfoResponse = await fetch(MICROSOFT_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userInfoResponse.ok) {
      console.error('[SSO] Failed to get user info');
      return redirectWithError(url.origin, 'Failed to get user information');
    }

    const userInfo = await userInfoResponse.json();

    // Create or update user via internal action
    const result = await ctx.runAction(internalApi.sso_providers.internal_actions.handleSsoLogin, {
      email: userInfo.mail || userInfo.userPrincipalName,
      name: userInfo.displayName || userInfo.givenName || '',
      microsoftId: userInfo.id,
      accessToken,
      domain: state.domain,
      organizationId: provider.organizationId,
    });

    if (!result.success) {
      return redirectWithError(url.origin, result.error || 'SSO login failed');
    }

    // Redirect to app with session token
    const successUrl = new URL('/app', url.origin);
    if (result.sessionToken) {
      successUrl.searchParams.set('session', result.sessionToken);
    }

    return new Response(null, {
      status: 302,
      headers: { Location: successUrl.toString() },
    });
  } catch (error) {
    console.error('[SSO] Callback error:', error);
    return redirectWithError(new URL(req.url).origin, 'Internal server error');
  }
});

function redirectWithError(origin: string, message: string): Response {
  const errorUrl = new URL('/log-in', origin);
  errorUrl.searchParams.set('error', message);
  return new Response(null, {
    status: 302,
    headers: { Location: errorUrl.toString() },
  });
}
