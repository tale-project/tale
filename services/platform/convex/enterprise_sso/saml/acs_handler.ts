import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { createAuth } from '../../auth';
import { signCookieValue } from '../sign_cookie_value';
import { mapSamlIdentity } from './attributes';
import { samlEndpoints } from './metadata_handler';

const SESSION_COOKIE_NAME = 'better-auth.session_token';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function loginRedirect(origin: string, message: string): Response {
  const basePath = process.env.BASE_PATH || '';
  const errorUrl = new URL(`${basePath}/log-in`, origin);
  errorUrl.searchParams.set('error', message);
  return new Response(null, {
    status: 302,
    headers: { Location: errorUrl.toString() },
  });
}

/**
 * POST /api/sso/saml/acs — SAML Assertion Consumer Service. Verifies the signed
 * (optionally encrypted) assertion in a Node action, maps attributes to our
 * identity, then funnels into the shared provisioning action and sets the
 * session cookie. RelayState carries the org id for SP-initiated flows.
 */
export async function samlAcsHandler(
  ctx: ActionCtx,
  req: Request,
): Promise<Response> {
  const origin = new URL(req.url).origin;
  try {
    const body = await req.text();
    const params = new URLSearchParams(body);
    const samlResponse = params.get('SAMLResponse');
    const relayState = params.get('RelayState') ?? undefined;
    if (!samlResponse) {
      return loginRedirect(origin, 'Missing SAMLResponse');
    }

    const config = await ctx.runQuery(
      internal.enterprise_sso.internal_queries.resolveSamlConfig,
      { organizationId: relayState },
    );
    if (!config) {
      return loginRedirect(origin, 'SAML is not configured');
    }

    const { spEntityId, acsUrl } = samlEndpoints();
    const secrets = await ctx.runAction(
      internal.enterprise_sso.config.file_actions.getConnectionSecrets,
      { organizationId: config.organizationId },
    );
    const spPrivateKey = secrets.spPrivateKey;

    const validation = await ctx.runAction(
      internal.enterprise_sso.saml.validate_assertion.validateSamlResponse,
      {
        samlResponse,
        relayState,
        idpSsoUrl: config.idpSsoUrl,
        idpCertificate: config.idpCertificate,
        spEntityId,
        acsUrl,
        spPrivateKey,
        wantAssertionsSigned: config.wantAssertionsSigned,
      },
    );
    if (!validation.ok) {
      console.error('[SSO] SAML validation failed:', validation.error);
      return loginRedirect(
        origin,
        validation.error || 'SAML validation failed',
      );
    }

    const identity = mapSamlIdentity(
      validation.nameId,
      validation.attributes ?? {},
      config.attributeMappings,
    );
    if ('error' in identity) {
      return loginRedirect(origin, identity.error);
    }

    const result = await ctx.runAction(
      internal.enterprise_sso.internal_actions.handleSsoLogin,
      {
        email: identity.email,
        name: identity.name,
        externalId: identity.externalId,
        providerId: 'saml',
        groups: identity.groups,
        rawClaims: identity.rawClaims,
        accessToken: '',
        organizationId: config.organizationId,
      },
    );
    if (!result.success || !result.sessionToken) {
      return loginRedirect(origin, result.error || 'SAML login failed');
    }

    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) return loginRedirect(origin, 'Server configuration error');

    const signedToken = await signCookieValue(result.sessionToken, secret);
    const isHttps = origin.startsWith('https://');
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

    const auth = createAuth(ctx);
    const authResponse = await auth.handler(
      new Request(new URL('/api/auth/get-session', origin).toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${result.sessionToken}`,
          'Content-Type': 'application/json',
        },
      }),
    );

    const headers = new Headers();
    const basePath = process.env.BASE_PATH || '';
    headers.set('Location', `${origin}${basePath}/dashboard`);
    headers.append('Set-Cookie', cookieParts.join('; '));
    authResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie')
        headers.append('Set-Cookie', value);
    });

    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error('[SSO] SAML ACS error:', error);
    return loginRedirect(origin, 'Internal server error');
  }
}
