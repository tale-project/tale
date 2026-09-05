import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
import {
  buildFlowCookie,
  hashFlowNonce,
  newFlowNonce,
} from '../login/flow_cookie';
import { publicOrigin } from '../login/public_origin';
import { redirectWithError } from '../login/redirect_with_error';
import { samlEndpoints } from './metadata_handler';
import { buildRelayState } from './relay_state';

/**
 * GET /api/sso/saml/login — SP-initiated SAML sign-in. Builds a signed
 * AuthnRequest (Redirect binding) in the Node action and 302s the browser to
 * the IdP, carrying the org id and the flow-cookie hash as RelayState so the
 * ACS handler can resolve the connection — and check the response came back
 * to the browser that asked for it — on the way back. (IdP-initiated flows
 * POST straight to the ACS.)
 */
export async function samlLoginHandler(
  ctx: ActionCtx,
  req: Request,
): Promise<Response> {
  try {
    const org = new URL(req.url).searchParams.get('org') ?? undefined;
    const browserOrigin = publicOrigin(req.url);
    const config = await ctx.runQuery(
      internal.enterprise_sso.internal_queries.resolveSamlConfig,
      { organizationId: org },
    );
    if (config === 'ambiguous') {
      // Several orgs have SSO enabled and no org context was given — same
      // never-guess rule as the OIDC authorize handler.
      return redirectWithError(browserOrigin, 'sso.errors.multipleConnections');
    }
    if (!config) {
      return new Response('SAML is not configured', { status: 404 });
    }
    const { spEntityId, acsUrl } = samlEndpoints();
    const flowNonce = newFlowNonce();
    const result = await ctx.runAction(
      internal.enterprise_sso.saml.validate_assertion.buildSamlAuthnRedirect,
      {
        idpEntityId: config.idpEntityId,
        idpSsoUrl: config.idpSsoUrl,
        idpCertificate: config.idpCertificate,
        spEntityId,
        acsUrl,
        relayState: buildRelayState(
          config.organizationId,
          await hashFlowNonce(flowNonce),
        ),
      },
    );
    if (!result.url) {
      console.error('[SSO] SAML AuthnRequest build failed:', result.error);
      return new Response(result.error ?? 'Failed to build SAML request', {
        status: 500,
      });
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: result.url,
        'Set-Cookie': buildFlowCookie(flowNonce, {
          frontendOrigin: browserOrigin,
        }),
      },
    });
  } catch (error) {
    console.error('[SSO] SAML login error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
