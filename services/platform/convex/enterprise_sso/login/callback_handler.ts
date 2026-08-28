import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
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
import { verifySignedValue } from '../sign_cookie_value';
import { finishLoginWithConvexAuth, type FinishLogin } from './finish_login';
import { recordSsoLoginFailure } from './login_audit';
import { redirectWithError } from './redirect_with_error';

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
  deps: { finishLogin: FinishLogin } = {
    finishLogin: finishLoginWithConvexAuth,
  },
): Promise<Response> {
  // Behind the reverse proxy the request origin is the INTERNAL Convex address
  // (unreachable from a browser), so error redirects must target the public
  // SITE_URL — refined to the state's own origin once the state is parsed.
  let publicOrigin = process.env.SITE_URL || new URL(req.url).origin;
  // Hoisted so the catch can write a durable audit row attributing the failure
  // to the right org/connection/user (populated as each is resolved below).
  let resolvedOrganizationId: string | undefined;
  let resolvedProviderId: string | undefined;
  let attemptedEmail: string | undefined;
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
              if (stateData.redirectUri) {
                publicOrigin = new URL(stateData.redirectUri).origin;
              }

              if (isSilentAuthError(error) && stateData.seamless) {
                const authorizeUrl = buildAuthorizeRedirectUrl(
                  publicOrigin,
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
                      publicOrigin,
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
                      publicOrigin,
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
        publicOrigin,
        `SSO login failed: ${errorDescription || error}`,
      );
    }

    if (!code || !stateParam) {
      return redirectWithError(
        publicOrigin,
        'Missing authorization code or state',
      );
    }

    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) {
      console.error('[SSO] BETTER_AUTH_SECRET not configured');
      return redirectWithError(publicOrigin, 'Server configuration error');
    }

    const verifiedPayload = await verifySignedValue(stateParam, secret);
    if (!verifiedPayload) {
      return redirectWithError(publicOrigin, 'Invalid state signature');
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
      return redirectWithError(publicOrigin, 'Invalid state parameter');
    }

    if (Date.now() - state.timestamp > 10 * 60 * 1000) {
      return redirectWithError(publicOrigin, 'SSO session expired');
    }

    // The state's redirectUri is the page the user actually came from — it
    // wins over SITE_URL from here on (covers multi-host deployments).
    const frontendOrigin = new URL(state.redirectUri).origin;
    publicOrigin = frontendOrigin;

    const config = await ctx.runQuery(
      internal.enterprise_sso.internal_queries.resolveSignInConfig,
      { organizationId: state.organizationId },
    );
    if (config === 'ambiguous') {
      // Only reachable for a state minted without an org (pre-#2082 flows) on
      // a deployment where several orgs enable SSO — never guess a connection.
      return redirectWithError(
        frontendOrigin,
        'sso.errors.multipleConnections',
      );
    }
    if (!config) {
      return redirectWithError(frontendOrigin, 'SSO configuration not found');
    }
    resolvedOrganizationId = config.organizationId;
    resolvedProviderId = config.providerId;

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
    attemptedEmail = userInfo.email;

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
        scope: tokens.scope,
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

    return await deps.finishLogin(ctx, {
      sessionToken: result.sessionToken,
      frontendOrigin,
    });
  } catch (error) {
    console.error('[SSO] Callback error:', error);
    // Token-exchange failures throw with Microsoft's response body in the
    // message (e.g. an invalid or expired client secret) — map its AADSTS
    // code to the same readable login-page error the authorize stage gets.
    const message = error instanceof Error ? error.message : String(error);
    const errorCode = parseEntraErrorCode(message);
    const errorInfo = errorCode ? getEntraErrorInfo(errorCode) : undefined;
    await recordSsoLoginFailure(ctx, {
      organizationId: resolvedOrganizationId,
      stage: 'callback',
      errorMessage: message,
      errorKey: errorInfo?.messageKey ?? 'sso.errors.serverError',
      attemptedEmail,
      providerId: resolvedProviderId,
    });
    if (errorCode && errorInfo) {
      return redirectWithError(
        publicOrigin,
        errorInfo.messageKey,
        errorCode,
        errorInfo.recoveryKey,
      );
    }
    return redirectWithError(publicOrigin, 'sso.errors.serverError');
  }
}
