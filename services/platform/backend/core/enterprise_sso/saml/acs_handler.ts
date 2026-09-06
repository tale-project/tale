import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
import { publicOrigin } from '../../lib/helpers/public_origin';
import { type FinishLogin } from '../login/finish_login';
import {
  clearFlowCookie,
  flowCookieMatches,
  hasFlowCookie,
  SSO_FLOW_MISMATCH_KEY,
} from '../login/flow_cookie';
import { recordSsoLoginFailure } from '../login/login_audit';
import { mapSamlIdentity } from './attributes';
import { samlEndpoints } from './metadata_handler';
import { parseRelayState } from './relay_state';

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
 * (and, when the connection requires it, encrypted) assertion in a Node
 * action, maps attributes to our identity, then funnels into the shared
 * provisioning action and sets the session cookie. RelayState carries the org
 * id — and, for SP-initiated flows, the flow-cookie hash that binds the
 * response to the browser that started the flow.
 */
export async function samlAcsHandler(
  ctx: ActionCtx,
  req: Request,
  deps: { finishLogin: FinishLogin },
): Promise<Response> {
  // The PUBLIC origin the browser is on, never the internal request origin:
  // it decides the session cookie's __Secure- shape, which ACS URL the
  // assertion is validated against and where every redirect lands (the OIDC
  // handlers' posture — behind the proxy `req.url` is the unreachable
  // internal upstream, and `http` even on TLS deployments).
  const origin = publicOrigin(req);
  const response = await consumeAssertion(ctx, req, deps, origin);
  // The flow cookie is single-use, whatever the verdict.
  if (hasFlowCookie(req.headers.get('cookie'), origin)) {
    response.headers.append(
      'Set-Cookie',
      clearFlowCookie({ frontendOrigin: origin }),
    );
  }
  return response;
}

async function consumeAssertion(
  ctx: ActionCtx,
  req: Request,
  deps: { finishLogin: FinishLogin },
  origin: string,
): Promise<Response> {
  // Known only once the assertion's connection resolves; every refusal after
  // that point is audited (the OIDC callback's posture — a rejected assertion
  // is exactly the event an operator investigating a locked-out user, or a
  // forged-assertion attempt, needs to see).
  let resolvedOrganizationId: string | undefined;
  let attemptedEmail: string | undefined;
  const auditFailure = async (
    errorMessage: string,
    errorKey?: string,
  ): Promise<void> => {
    await recordSsoLoginFailure(ctx, {
      organizationId: resolvedOrganizationId,
      stage: 'callback',
      errorMessage,
      ...(errorKey !== undefined ? { errorKey } : {}),
      ...(attemptedEmail !== undefined ? { attemptedEmail } : {}),
      providerId: 'saml',
    });
  };
  try {
    const body = await req.text();
    const params = new URLSearchParams(body);
    const samlResponse = params.get('SAMLResponse');
    const relayState = params.get('RelayState') ?? undefined;
    if (!samlResponse) {
      return loginRedirect(origin, 'Missing SAMLResponse');
    }

    const relay = parseRelayState(relayState);
    const config = await ctx.runQuery(
      internal.enterprise_sso.internal_queries.resolveSamlConfig,
      { organizationId: relay.organizationId },
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

    resolvedOrganizationId = config.organizationId;
    // Validated against the ACS on the origin the IdP actually posted to —
    // the one the login door asked for (SP-initiated) or the one the IdP has
    // registered (IdP-initiated); each configured site origin has its own.
    const { spEntityId, acsUrl } = samlEndpoints(origin);
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
        idpEntityId: config.idpEntityId,
        idpSsoUrl: config.idpSsoUrl,
        idpCertificate: config.idpCertificate,
        spEntityId,
        acsUrl,
        spPrivateKey,
        wantAssertionsSigned: config.wantAssertionsSigned,
        wantAssertionsEncrypted: config.wantAssertionsEncrypted,
      },
    );
    if (!validation.ok) {
      console.error('[SSO] SAML validation failed:', validation.error);
      const message = validation.error || 'SAML validation failed';
      // A refusal with its own login-page key (the encryption requirement)
      // is audited under its readable reason and bounced with the key; every
      // other validator error is bounced as the readable reason itself.
      await auditFailure(message, validation.errorKey);
      return loginRedirect(origin, validation.errorKey ?? message);
    }

    // An SP-initiated response (it answers an AuthnRequest — InResponseTo on
    // the Response or inside the signed Subject) must land in the browser
    // that issued that request: the RelayState's hash has to be of the nonce
    // in this browser's flow cookie. Without it, an insider's own captured
    // response posted from a victim's browser would sign the victim in as
    // the insider. An IdP-initiated response answers no request and carries
    // no binding — that is the protocol's shape, documented as such.
    if (validation.inResponseTo !== undefined) {
      const bound =
        relay.flowHash !== undefined &&
        (await flowCookieMatches(
          req.headers.get('cookie'),
          relay.flowHash,
          origin,
        ));
      if (!bound) {
        const message =
          'SAML response did not arrive in the browser that started the flow (missing or mismatched flow cookie)';
        console.warn(`[SSO] ${message}`);
        await auditFailure(message, SSO_FLOW_MISMATCH_KEY);
        return loginRedirect(origin, SSO_FLOW_MISMATCH_KEY);
      }
    }

    const identity = mapSamlIdentity(
      validation.nameId,
      validation.attributes ?? {},
      config.attributeMappings,
    );
    if ('error' in identity) {
      await auditFailure(identity.error);
      return loginRedirect(origin, identity.error);
    }
    attemptedEmail = identity.email;

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
      const message = result.error || 'SAML login failed';
      await auditFailure(message);
      return loginRedirect(origin, message);
    }

    return await deps.finishLogin(ctx, {
      sessionToken: result.sessionToken,
      frontendOrigin: origin,
    });
  } catch (error) {
    console.error('[SSO] SAML ACS error:', error);
    await auditFailure(
      error instanceof Error ? error.message : String(error),
      'sso.errors.serverError',
    );
    return loginRedirect(origin, 'Internal server error');
  }
}
