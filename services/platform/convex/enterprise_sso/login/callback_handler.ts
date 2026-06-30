import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { createAuth } from '../../auth';
import { decryptString } from '../../lib/crypto/decrypt_string';
import { sanitizeRawClaims } from '../claims';
import { parseIdTokenAuthContext } from '../entra_id/adapter';
import {
  parseEntraErrorCode,
  getEntraErrorInfo,
  isSilentAuthError,
  extractClaimsChallenge,
} from '../entra_id/error_codes';
import { getAdapter } from '../registry';
import { signCookieValue, verifySignedValue } from '../sign_cookie_value';

const SESSION_COOKIE_NAME = 'better-auth.session_token';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function redirectWithError(
  origin: string,
  message: string,
  errorCode?: string,
  recoveryKey?: string,
): Response {
  const basePath = process.env.BASE_PATH || '';
  const errorUrl = new URL(`${basePath}/log-in`, origin);
  errorUrl.searchParams.set('error', message);
  if (errorCode) errorUrl.searchParams.set('error_code', errorCode);
  if (recoveryKey) errorUrl.searchParams.set('recovery', recoveryKey);
  return new Response(null, {
    status: 302,
    headers: { Location: errorUrl.toString() },
  });
}

function buildAuthorizeRedirectUrl(
  origin: string,
  redirectUri: string,
  params: Record<string, string>,
): string {
  const basePath = process.env.BASE_PATH || '';
  const authorizeUrl = new URL(
    `${basePath}/http_api/api/sso/authorize`,
    origin,
  );
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  for (const [key, value] of Object.entries(params)) {
    authorizeUrl.searchParams.set(key, value);
  }
  return authorizeUrl.toString();
}

/**
 * GET /api/sso/callback — OIDC/OAuth2 authorization-code callback. Validates
 * the signed state, exchanges the code (with the PKCE verifier carried in
 * state), fetches userinfo, then funnels into the shared provisioning action.
 */
export async function ssoCallbackHandler(
  ctx: ActionCtx,
  req: Request,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const stateParam = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');

    if (error) {
      console.error('[SSO] OAuth error:', error, errorDescription);
      if (stateParam) {
        const secret = process.env.BETTER_AUTH_SECRET;
        if (secret) {
          const verifiedPayload = await verifySignedValue(stateParam, secret);
          if (verifiedPayload) {
            try {
              const base64 = verifiedPayload
                .replace(/-/g, '+')
                .replace(/_/g, '/');
              const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
              const stateData = JSON.parse(atob(padded));

              if (isSilentAuthError(error) && stateData.seamless) {
                const authorizeUrl = buildAuthorizeRedirectUrl(
                  url.origin,
                  stateData.redirectUri,
                  {
                    prompt: 'login',
                    ...(stateData.organizationId
                      ? { organizationId: stateData.organizationId }
                      : {}),
                  },
                );
                return new Response(null, {
                  status: 302,
                  headers: { Location: authorizeUrl },
                });
              }

              if (errorDescription) {
                const errorCode = parseEntraErrorCode(errorDescription);
                if (errorCode) {
                  const errorInfo = getEntraErrorInfo(errorCode);
                  if (errorInfo?.requiresStepUp) {
                    const claimsChallenge =
                      extractClaimsChallenge(errorDescription);
                    const params: Record<string, string> = { prompt: 'login' };
                    if (stateData.organizationId) {
                      params['organizationId'] = stateData.organizationId;
                    }
                    if (claimsChallenge) params['claims'] = claimsChallenge;
                    const authorizeUrl = buildAuthorizeRedirectUrl(
                      url.origin,
                      stateData.redirectUri,
                      params,
                    );
                    return new Response(null, {
                      status: 302,
                      headers: { Location: authorizeUrl },
                    });
                  }
                  if (errorInfo) {
                    return redirectWithError(
                      url.origin,
                      errorInfo.messageKey,
                      errorCode,
                      errorInfo.recoveryKey,
                    );
                  }
                }
              }
            } catch {
              // State parsing failed, fall through to generic error
            }
          }
        }
      }
      return redirectWithError(
        url.origin,
        `SSO login failed: ${errorDescription || error}`,
      );
    }

    if (!code || !stateParam) {
      return redirectWithError(
        url.origin,
        'Missing authorization code or state',
      );
    }

    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) {
      console.error('[SSO] BETTER_AUTH_SECRET not configured');
      return redirectWithError(url.origin, 'Server configuration error');
    }

    const verifiedPayload = await verifySignedValue(stateParam, secret);
    if (!verifiedPayload) {
      return redirectWithError(url.origin, 'Invalid state signature');
    }

    let state: {
      redirectUri: string;
      timestamp: number;
      pkce?: string;
      organizationId?: string;
    };
    try {
      const base64 = verifiedPayload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      state = JSON.parse(atob(padded));
    } catch {
      return redirectWithError(url.origin, 'Invalid state parameter');
    }

    if (Date.now() - state.timestamp > 10 * 60 * 1000) {
      return redirectWithError(url.origin, 'SSO session expired');
    }

    const frontendOrigin = new URL(state.redirectUri).origin;

    const config = await ctx.runQuery(
      internal.enterprise_sso.internal_queries.resolveSignInConfig,
      { organizationId: state.organizationId },
    );
    if (!config) {
      return redirectWithError(frontendOrigin, 'SSO configuration not found');
    }

    const adapter = getAdapter(config.providerId);
    if (!adapter) {
      return redirectWithError(
        frontendOrigin,
        `Unsupported SSO provider: ${config.providerId}`,
      );
    }

    const secrets = await ctx.runAction(
      internal.enterprise_sso.config.file_actions.getConnectionSecrets,
      { organizationId: config.organizationId },
    );
    const clientId = secrets.clientId;
    const clientSecret = secrets.clientSecret;
    if (!clientId || !clientSecret) {
      return redirectWithError(frontendOrigin, 'SSO configuration not found');
    }

    const ssoConfig = {
      providerId: config.providerId,
      issuer: config.issuer,
      authorizationEndpoint: config.authorizationEndpoint,
      tokenEndpoint: config.tokenEndpoint,
      userinfoEndpoint: config.userinfoEndpoint,
      clientId,
      clientSecret,
      scopes: config.scopes,
      claimMappings: config.claimMappings,
    };

    let codeVerifier: string | undefined;
    if (state.pkce) {
      try {
        codeVerifier = await decryptString(state.pkce);
      } catch (e) {
        console.error('[SSO] Failed to decrypt PKCE verifier from state:', e);
        return redirectWithError(frontendOrigin, 'Invalid PKCE state');
      }
    }

    const tokens = await adapter.exchangeCodeForTokens(ssoConfig, {
      code,
      redirectUri: state.redirectUri,
      codeVerifier,
    });

    const userInfo = await adapter.getUserInfo(ssoConfig, tokens.accessToken);

    if (tokens.idToken) {
      const authContext = parseIdTokenAuthContext(tokens.idToken);
      if (authContext) userInfo.authContext = authContext;
    }

    let appRoles: string[] = [];
    if (config.autoProvisionRole && adapter.getAppRoles) {
      try {
        appRoles = await adapter.getAppRoles(ssoConfig, tokens.accessToken);
      } catch (e) {
        console.warn('[SSO] Failed to fetch app roles:', e);
      }
    }

    // Resolve the full group list when groups drive role mapping OR team sync.
    const needsGroups =
      config.autoProvisionTeam ||
      (config.autoProvisionRole &&
        config.roleMappingRules.some((rule) => rule.source === 'group'));
    if (needsGroups && !userInfo.groups?.length && adapter.getGroups) {
      try {
        const groups = await adapter.getGroups(ssoConfig, tokens.accessToken);
        userInfo.groups = groups.map((group) => group.name);
      } catch (e) {
        console.warn('[SSO] Failed to fetch groups:', e);
      }
    }

    const result = await ctx.runAction(
      internal.enterprise_sso.internal_actions.handleSsoLogin,
      {
        email: userInfo.email,
        name: userInfo.name,
        externalId: userInfo.externalId,
        providerId: config.providerId,
        jobTitle: userInfo.jobTitle,
        appRoles,
        groups: userInfo.groups,
        rawClaims: sanitizeRawClaims(userInfo.rawClaims),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.expiresAt,
        organizationId: config.organizationId,
      },
    );

    if (!result.success) {
      return redirectWithError(
        frontendOrigin,
        result.error || 'SSO login failed',
      );
    }
    if (!result.sessionToken) {
      return redirectWithError(frontendOrigin, 'Failed to create session');
    }

    const signedToken = await signCookieValue(result.sessionToken, secret);
    const isHttps = frontendOrigin.startsWith('https://');
    const cookieName = isHttps
      ? `__Secure-${SESSION_COOKIE_NAME}`
      : SESSION_COOKIE_NAME;

    const cookieParts = [
      `${cookieName}=${signedToken}`,
      `Max-Age=${SESSION_MAX_AGE}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
    ];
    if (isHttps) cookieParts.push('Secure');
    const sessionCookie = cookieParts.join('; ');

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

    const cookies: string[] = [sessionCookie];
    authResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') cookies.push(value);
    });

    const headers = new Headers();
    const basePath = process.env.BASE_PATH || '';
    headers.set('Location', `${frontendOrigin}${basePath}/dashboard`);
    for (const cookie of cookies) headers.append('Set-Cookie', cookie);

    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error('[SSO] Callback error:', error);
    return redirectWithError(new URL(req.url).origin, 'Internal server error');
  }
}
