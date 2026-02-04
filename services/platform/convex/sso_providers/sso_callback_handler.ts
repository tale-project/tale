import { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { decryptString } from '../lib/crypto/decrypt_string';
import { signCookieValue } from './sign_cookie_value';
import { createAuth } from '../auth';

const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com';
const MICROSOFT_USERINFO_URL =
  'https://graph.microsoft.com/v1.0/me?$select=id,displayName,givenName,mail,userPrincipalName,jobTitle';
const MICROSOFT_APP_ROLES_URL =
  'https://graph.microsoft.com/v1.0/me/appRoleAssignments?$select=appRoleId,principalDisplayName';

const SESSION_COOKIE_NAME = 'better-auth.session_token';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

function redirectWithError(origin: string, message: string): Response {
  const errorUrl = new URL('/log-in', origin);
  errorUrl.searchParams.set('error', message);
  return new Response(null, {
    status: 302,
    headers: { Location: errorUrl.toString() },
  });
}

export async function ssoCallbackHandler(ctx: ActionCtx, req: Request): Promise<Response> {
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

    let state: { redirectUri: string; timestamp: number };
    try {
      const base64 = stateParam.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      state = JSON.parse(atob(padded));
    } catch {
      return redirectWithError(url.origin, 'Invalid state parameter');
    }

    if (Date.now() - state.timestamp > 10 * 60 * 1000) {
      return redirectWithError(url.origin, 'SSO session expired');
    }

    const frontendOrigin = new URL(state.redirectUri).origin;

    const provider = await ctx.runQuery(internal.sso_providers.internal_queries.getSsoConfig, {});

    if (!provider) {
      return redirectWithError(frontendOrigin, 'SSO configuration not found');
    }

    const clientId = await decryptString(provider.clientIdEncrypted);
    const clientSecret = await decryptString(provider.clientSecretEncrypted);

    const tenantId = provider.issuer.includes('login.microsoftonline.com')
      ? provider.issuer.split('/')[3] || 'common'
      : 'common';

    const tokenResponse = await fetch(`${MICROSOFT_TOKEN_URL}/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: state.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[SSO] Token exchange failed:', errorText);
      return redirectWithError(frontendOrigin, 'Failed to exchange authorization code');
    }

    const tokens = await tokenResponse.json();
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    const expiresIn = tokens.expires_in;
    const accessTokenExpiresAt = expiresIn ? Date.now() + expiresIn * 1000 : undefined;

    const userInfoResponse = await fetch(MICROSOFT_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userInfoResponse.ok) {
      console.error('[SSO] Failed to get user info');
      return redirectWithError(frontendOrigin, 'Failed to get user information');
    }

    const userInfo = await userInfoResponse.json();

    // Fetch App Roles if role auto-provisioning is enabled
    let appRoles: string[] = [];
    if (provider.autoProvisionRole) {
      try {
        const appRolesResponse = await fetch(MICROSOFT_APP_ROLES_URL, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (appRolesResponse.ok) {
          const appRolesData = await appRolesResponse.json();
          appRoles = (appRolesData.value || []).map(
            (r: { principalDisplayName?: string }) => r.principalDisplayName || '',
          );
        }
      } catch (e) {
        console.warn('[SSO] Failed to fetch app roles:', e);
      }
    }

    const result = await ctx.runAction(internal.sso_providers.internal_actions.handleSsoLogin, {
      email: userInfo.mail || userInfo.userPrincipalName,
      name: userInfo.displayName || userInfo.givenName || '',
      microsoftId: userInfo.id,
      jobTitle: userInfo.jobTitle || undefined,
      appRoles,
      accessToken,
      refreshToken,
      accessTokenExpiresAt,
      organizationId: provider.organizationId,
    });

    if (!result.success) {
      return redirectWithError(frontendOrigin, result.error || 'SSO login failed');
    }

    if (!result.sessionToken) {
      return redirectWithError(frontendOrigin, 'Failed to create session');
    }

    // Sign the session token using the same method as Better Auth
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) {
      console.error('[SSO] BETTER_AUTH_SECRET not configured');
      return redirectWithError(frontendOrigin, 'Server configuration error');
    }

    // Sign the token (this creates the format: encodeURIComponent(`${token}.${base64Signature}`))
    const signedToken = await signCookieValue(result.sessionToken, secret);

    // Determine if we should use secure cookies (HTTPS)
    const isHttps = frontendOrigin.startsWith('https://');
    const cookieName = isHttps ? `__Secure-${SESSION_COOKIE_NAME}` : SESSION_COOKIE_NAME;

    // Build the Set-Cookie header for session_token
    const cookieParts = [
      `${cookieName}=${signedToken}`,
      `Max-Age=${SESSION_MAX_AGE}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
    ];
    if (isHttps) {
      cookieParts.push('Secure');
    }
    const sessionCookie = cookieParts.join('; ');

    // Get JWT cookie from Better Auth by calling get-session with Bearer token
    const auth = createAuth(ctx);
    const getSessionUrl = new URL('/api/auth/get-session', frontendOrigin);
    const getSessionRequest = new Request(getSessionUrl.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${result.sessionToken}`,
        'Content-Type': 'application/json',
      },
    });

    const authResponse = await auth.handler(getSessionRequest);

    // Collect all Set-Cookie headers (session cookie + JWT cookie from Better Auth)
    const cookies: string[] = [sessionCookie];
    authResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        cookies.push(value);
      }
    });

    // Redirect directly to dashboard
    const headers = new Headers();
    headers.set('Location', `${frontendOrigin}/dashboard`);
    for (const cookie of cookies) {
      headers.append('Set-Cookie', cookie);
    }

    return new Response(null, {
      status: 302,
      headers,
    });
  } catch (error) {
    console.error('[SSO] Callback error:', error);
    return redirectWithError(new URL(req.url).origin, 'Internal server error');
  }
}
