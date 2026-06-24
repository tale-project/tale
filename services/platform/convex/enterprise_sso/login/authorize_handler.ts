import { internal } from '../../_generated/api';
import { ActionCtx } from '../../_generated/server';
import { encryptString } from '../../lib/crypto/encrypt_string';
import { ONEDRIVE_SCOPES } from '../entra_id/adapter';
import { generatePkcePair } from '../pkce';
import { getAdapter } from '../registry';
import { signValue } from '../sign_cookie_value';
import type { SsoPromptMode } from '../types';

const VALID_PROMPTS: Record<string, SsoPromptMode> = {
  none: 'none',
  login: 'login',
  consent: 'consent',
  select_account: 'select_account',
};

function parsePrompt(value: string): SsoPromptMode | undefined {
  return VALID_PROMPTS[value];
}

function normalizeOrigin(origin: string): string {
  return origin.replace('127.0.0.1', 'localhost');
}

/**
 * GET /api/sso/authorize — build the IdP authorization redirect for the org's
 * OIDC/OAuth2 connection. PKCE (when the adapter supports it) is generated here
 * and carried, encrypted, inside the signed state so the flow stays stateless.
 */
export async function ssoAuthorizeHandler(
  ctx: ActionCtx,
  req: Request,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const email = url.searchParams.get('email');
    const organizationId = url.searchParams.get('organizationId') || undefined;
    const promptParam = url.searchParams.get('prompt');
    const seamlessParam = url.searchParams.get('seamless');
    const claimsParam = url.searchParams.get('claims');
    const normalizedOrigin = normalizeOrigin(url.origin);
    const redirectUri =
      url.searchParams.get('redirect_uri') ||
      `${normalizedOrigin}/api/sso/callback`;

    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) {
      console.error('[SSO] BETTER_AUTH_SECRET not configured');
      return new Response('Server configuration error', { status: 500 });
    }

    const config = await ctx.runQuery(
      internal.enterprise_sso.internal_queries.resolveSignInConfig,
      { organizationId },
    );
    if (!config) {
      return new Response('No SSO configuration found', { status: 404 });
    }

    const adapter = getAdapter(config.providerId);
    if (!adapter) {
      return new Response(`Unsupported SSO provider: ${config.providerId}`, {
        status: 400,
      });
    }

    const loginHint = email || undefined;
    let prompt: SsoPromptMode | undefined;
    if (promptParam) prompt = parsePrompt(promptParam);
    if (!prompt && seamlessParam === 'true') prompt = 'none';

    const secrets = await ctx.runAction(
      internal.enterprise_sso.config.file_actions.getConnectionSecrets,
      { organizationId: config.organizationId },
    );
    const clientId = secrets.clientId;
    if (!clientId) {
      return new Response('No SSO configuration found', { status: 404 });
    }

    let codeChallenge: string | undefined;
    let encryptedPkceVerifier: string | undefined;
    if (adapter.capabilities.supportsPkce && config.pkce) {
      const pkce = await generatePkcePair();
      codeChallenge = pkce.challenge;
      encryptedPkceVerifier = await encryptString(pkce.verifier);
    }

    const statePayload = JSON.stringify({
      redirectUri,
      timestamp: Date.now(),
      seamless: prompt === 'none',
      // Bind the resolved org to the state so the callback exchanges the code
      // against the SAME connection — not whichever is first enabled (#2082).
      organizationId: config.organizationId,
      ...(encryptedPkceVerifier ? { pkce: encryptedPkceVerifier } : {}),
    });
    const base64Payload = btoa(statePayload)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const state = await signValue(base64Payload, secret);

    const scopes = [...config.scopes];
    const additionalScopes: string[] = [];
    if (config.enableOneDriveAccess) {
      for (const scope of ONEDRIVE_SCOPES) {
        if (!scopes.includes(scope)) additionalScopes.push(scope);
      }
    }

    const authUrl = await adapter.buildAuthorizeUrl(
      {
        providerId: config.providerId,
        issuer: config.issuer,
        authorizationEndpoint: config.authorizationEndpoint,
        tokenEndpoint: config.tokenEndpoint,
        userinfoEndpoint: config.userinfoEndpoint,
        clientId,
        clientSecret: '',
        scopes,
        claimMappings: config.claimMappings,
      },
      {
        redirectUri,
        state,
        loginHint,
        additionalScopes,
        prompt,
        domainHint: config.domainHint,
        claims: claimsParam || undefined,
        codeChallenge,
      },
    );

    return new Response(null, {
      status: 302,
      headers: { Location: authUrl.toString() },
    });
  } catch (error) {
    console.error('[SSO] Authorize error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
