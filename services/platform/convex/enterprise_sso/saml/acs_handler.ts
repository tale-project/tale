import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import {
  finishLoginWithConvexAuth,
  type FinishLogin,
} from '../login/finish_login';
import { mapSamlIdentity } from './attributes';
import { samlEndpoints } from './metadata_handler';

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
  deps: { finishLogin: FinishLogin } = {
    finishLogin: finishLoginWithConvexAuth,
  },
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
    if (config === 'ambiguous') {
      // IdP-initiated POST without a RelayState org on a deployment where
      // several orgs enable SSO — never guess which connection to validate
      // the assertion against.
      return loginRedirect(origin, 'sso.errors.multipleConnections');
    }
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

    return await deps.finishLogin(ctx, {
      sessionToken: result.sessionToken,
      frontendOrigin: origin,
    });
  } catch (error) {
    console.error('[SSO] SAML ACS error:', error);
    return loginRedirect(origin, 'Internal server error');
  }
}
