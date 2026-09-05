import { decryptString } from '../../lib/crypto/decrypt_string';
import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
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
import type { FinishLogin } from './finish_login';
import {
  clearFlowCookie,
  flowCookieMatches,
  hasFlowCookie,
  SSO_FLOW_MISMATCH_KEY,
} from './flow_cookie';
import { recordSsoLoginFailure } from './login_audit';
import { allowedRedirectOrigin } from './redirect_origins';
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
 * the signed state and its browser binding (the flow cookie), exchanges the
 * code (with the PKCE verifier carried in state), fetches userinfo, then
 * funnels into the shared provisioning action.
 */
export async function ssoCallbackHandler(
  ctx: ActionCtx,
  req: Request,
  deps: { finishLogin: FinishLogin },
): Promise<Response> {
  // Behind the reverse proxy the request origin is the INTERNAL Convex address
  // (unreachable from a browser), so the browser's origin is the public
  // SITE_URL — it names the flow cookie the authorize door set.
  const browserOrigin = process.env.SITE_URL || new URL(req.url).origin;
  const response = await completeCallback(ctx, req, deps, browserOrigin);
  // The flow cookie is single-use: once the browser has been here it is gone,
  // whatever the verdict — a retry starts a fresh flow with a fresh nonce.
  if (hasFlowCookie(req.headers.get('cookie'), browserOrigin)) {
    response.headers.append(
      'Set-Cookie',
      clearFlowCookie({ frontendOrigin: browserOrigin }),
    );
  }
  return response;
}

async function completeCallback(
  ctx: ActionCtx,
  req: Request,
  deps: { finishLogin: FinishLogin },
  browserOrigin: string,
): Promise<Response> {
  // Error redirects target the public origin — refined to the state's own
  // (allowlisted) origin once the state is parsed.
  let publicOrigin = browserOrigin;
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
              // Signed, but still caller-chosen at /authorize time: only an
              // origin of ours may become the bounce target.
              const stateOrigin = allowedRedirectOrigin(
                stateData.redirectUri,
                req.url,
              );
              if (stateOrigin === undefined) {
                throw new Error(
                  `state redirect_uri is outside this deployment: ${String(stateData.redirectUri)}`,
                );
              }
              publicOrigin = stateOrigin;

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
            } catch (e) {
              // A signature-verified state that still fails to parse (or a
              // throwing error mapping) falls through to the generic error;
              // the operator keeps a trace of why.
              console.warn(
                '[SSO] Could not use state on IdP error redirect:',
                e,
              );
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
      /** sha256 of the flow cookie the authorize door set in this browser. */
      flow?: string;
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
    // wins over SITE_URL from here on, but only when it is one of ours: the
    // signature proves we minted the state, not that its URI points at us.
    const frontendOrigin = allowedRedirectOrigin(state.redirectUri, req.url);
    if (frontendOrigin === undefined) {
      console.warn(
        '[SSO] Refusing state whose redirect_uri is outside this deployment:',
        state.redirectUri,
      );
      return redirectWithError(publicOrigin, 'Invalid state parameter');
    }
    publicOrigin = frontendOrigin;

    // The completion must arrive in the browser that started the flow: the
    // state's hash has to be of the nonce in this browser's flow cookie. A
    // valid, unexpired state alone is exactly what a login-CSRF attacker
    // holds for their own flow.
    if (
      !(await flowCookieMatches(
        req.headers.get('cookie'),
        state.flow,
        browserOrigin,
      ))
    ) {
      const message =
        'SSO completion did not arrive in the browser that started the flow (missing or mismatched flow cookie)';
      console.warn(`[SSO] ${message}`);
      await recordSsoLoginFailure(ctx, {
        organizationId: state.organizationId,
        stage: 'callback',
        errorMessage: message,
        errorKey: SSO_FLOW_MISMATCH_KEY,
      });
      return redirectWithError(frontendOrigin, SSO_FLOW_MISMATCH_KEY);
    }

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
        config.roleMappingRules.some(
          (rule: { source: string }) => rule.source === 'group',
        ));
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

    if (!result.success || !result.sessionToken) {
      // A refused provisioning (e.g. the asserted email belongs to a user
      // outside this org) is exactly what an operator investigating a
      // locked-out user needs to see — audit it like the ACS handler does,
      // instead of leaving the redirect as the only trace.
      const message = !result.success
        ? result.error || 'SSO login failed'
        : 'Failed to create session';
      await recordSsoLoginFailure(ctx, {
        organizationId: config.organizationId,
        stage: 'callback',
        errorMessage: message,
        ...(message.startsWith('sso.errors.') ? { errorKey: message } : {}),
        attemptedEmail,
        providerId: config.providerId,
      });
      return redirectWithError(frontendOrigin, message);
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
