/**
 * The OAuth2 authorization-code flow for connectors: `start` sends
 * the user to the vendor, `callback` turns the returned code into a stored
 * credential.
 *
 * The flow's security rests on four things, each enforced in one place:
 *
 *  - the `state` is opaque, single-use and server-side (`oauth_state.ts` +
 *    `oauth_state_mutations.ts`). It carries no meaning a caller could forge;
 *    everything the callback trusts is read from the row it consumes;
 *  - PKCE S256 binds the authorization code to THIS deployment, so a code
 *    intercepted in the browser cannot be redeemed elsewhere;
 *  - the `redirect_uri` is derived from the deployment's own site URL and never
 *    from a request parameter — an OAuth callback that can be re-pointed is an
 *    open redirect that hands out authorization codes;
 *  - the exchange runs server to server. Tokens go straight into the encrypted
 *    credential envelope: never into a response, a redirect, or a log line.
 *
 * Tenant isolation is the same property stated for data: the credential is
 * written for the organization the STATE was minted for, after that
 * organization's membership was verified at mint time. Nothing in the callback
 * request can move it.
 */

import { defineAbilityFor } from '../../lib/permissions/ability';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { generatePkcePair } from '../enterprise_sso/pkce';
import { buildAuthorizeUrl } from './authorize_url';
import {
  STORE_OAUTH2_CREDENTIAL_PATH,
  storeOauth2CredentialRef,
} from './credential_seam';
import {
  oauthAppEnvPrefix,
  resolveConnectorSettingsUrl,
  resolveOauthAppCredentials,
  resolveOauthRedirectUri,
} from './deployment_config';
import {
  renderConnectorErrorPage,
  type ConnectorErrorKind,
} from './error_page';
import {
  claimTeamRouteRef,
  consumePendingAuthorizationRef,
  createPendingAuthorizationRef,
  getOauth2EndpointsRef,
  resolveTeamRouteRef,
} from './function_refs';
import {
  hashStateToken,
  isPlausibleStateToken,
  mintStateToken,
} from './oauth_state';
import { resolveSessionUser } from './session';
import { exchangeAuthorizationCode } from './token_exchange';

/**
 * Connector slugs are directory names in the shipped catalog; anything else is
 * refused before it is used to look one up.
 */
const CONNECTOR_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Better Auth's soft-delete marker for a member — not a member any more. */
const DISABLED_ROLE = 'disabled';

function plainText(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      // The answer depends on the session cookie; a caching proxy keying only
      // on the URL would serve one user's outcome to another.
      Vary: 'Cookie',
    },
  });
}

function errorPage(
  kind: ConnectorErrorKind,
  organizationId?: string,
): Response {
  return renderConnectorErrorPage(
    kind,
    organizationId ? resolveConnectorSettingsUrl(organizationId) : null,
  );
}

/**
 * GET /api/connectors/oauth2/start?connector=<slug>&organizationId=<id>
 *
 * Verifies that the signed-in user may add credentials to the organization,
 * mints the pending authorization, and redirects to the vendor's consent
 * screen. Nothing is written for the organization until the callback returns.
 */
export async function oauth2StartHandler(
  ctx: ActionCtx,
  req: Request,
): Promise<Response> {
  const url = new URL(req.url);
  const connectorSlug = url.searchParams.get('connector') ?? '';
  const organizationId = url.searchParams.get('organizationId') ?? '';

  if (!CONNECTOR_SLUG_RE.test(connectorSlug) || organizationId.length === 0) {
    return errorPage('unsupported_connector');
  }

  // Fixed by the deployment. Read before anything else so a misconfigured
  // SITE_URL fails as a configuration problem rather than half-way through a
  // consent flow.
  const redirectUri = resolveOauthRedirectUri();
  if (!redirectUri) {
    console.error(
      '[connectors:oauth2] SITE_URL is unset — refusing to derive an OAuth redirect URI from the request',
    );
    return errorPage('not_configured');
  }

  const user = await resolveSessionUser(ctx, req);
  if (!user) {
    return plainText('Sign in to connect an connector.', 401);
  }

  const role = await ctx.runQuery(
    internal.members.internal_queries.getMemberRole,
    { userId: user.userId, organizationId },
  );
  if (role === null || role === DISABLED_ROLE) {
    // Same answer for "no such organization" and "not your organization": the
    // difference is only useful to someone enumerating org ids.
    return plainText('You do not have access to this organization.', 403);
  }
  // The same capability the credentials domain requires for a credential write
  // — connecting an connector IS one, just spelled as a consent flow.
  if (defineAbilityFor(role).cannot('read', 'developerSettings')) {
    return plainText(
      'Your role cannot connect connectors for this organization.',
      403,
    );
  }

  const endpoints = await ctx.runAction(getOauth2EndpointsRef, {
    connectorSlug,
  });
  if (!endpoints) {
    return errorPage('unsupported_connector', organizationId);
  }

  const app = resolveOauthAppCredentials(connectorSlug);
  if (!app) {
    const prefix = oauthAppEnvPrefix(connectorSlug);
    console.error(
      `[connectors:oauth2] no OAuth app configured for "${connectorSlug}": set ${prefix}CLIENT_ID and ${prefix}CLIENT_SECRET`,
    );
    return errorPage('not_configured', organizationId);
  }

  const pkce = await generatePkcePair();
  const state = mintStateToken();
  await ctx.runMutation(createPendingAuthorizationRef, {
    stateHash: await hashStateToken(state),
    organizationId,
    userId: user.userId,
    connectorSlug,
    codeVerifier: pkce.verifier,
    redirectUri,
  });

  let authorizeUrl: string;
  try {
    authorizeUrl = buildAuthorizeUrl({
      authorizeUrl: endpoints.authorizeUrl,
      scopes: endpoints.scopes,
      clientId: app.clientId,
      redirectUri,
      state,
      codeChallenge: pkce.challenge,
    });
  } catch (error) {
    console.error(
      `[connectors:oauth2] connector "${connectorSlug}" has an unusable authorize URL:`,
      error instanceof Error ? error.message : String(error),
    );
    return errorPage('unsupported_connector', organizationId);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl,
      // The URL carries the state token; keep it out of every cache.
      'Cache-Control': 'no-store',
      // The start URL names the organization — do not hand it to the vendor
      // as a referrer.
      'Referrer-Policy': 'no-referrer',
      Vary: 'Cookie',
    },
  });
}

/**
 * GET /api/connectors/oauth2/callback?code=…&state=…
 *
 * The vendor's front-channel return. Everything trusted here comes from the
 * consumed state row; the request supplies only the authorization code, which
 * is worthless without the PKCE verifier held server-side.
 */
export async function oauth2CallbackHandler(
  ctx: ActionCtx,
  req: Request,
): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  if (!isPlausibleStateToken(state)) {
    return errorPage('invalid_state');
  }

  // Consume FIRST, whatever else the request says. A replayed callback must
  // burn its token even when it also carries an error, so a captured URL can
  // never be retried into a second exchange.
  const pending = await ctx.runMutation(consumePendingAuthorizationRef, {
    stateHash: await hashStateToken(state),
  });
  if (!pending.ok) {
    console.warn(
      `[connectors:oauth2] refused a callback with a ${pending.reason} state`,
    );
    return errorPage('invalid_state');
  }
  const { organizationId, userId, connectorSlug, codeVerifier, redirectUri } =
    pending;

  // A user who declines consent comes back with `error`, not `code`. Slack and
  // Google both use `access_denied`; the value is never rendered.
  const vendorError = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  if (vendorError || !code) {
    console.info(
      `[connectors:oauth2] "${connectorSlug}" consent did not complete for organization ${organizationId}`,
    );
    return errorPage('vendor_declined', organizationId);
  }

  const endpoints = await ctx.runAction(getOauth2EndpointsRef, {
    connectorSlug,
  });
  if (!endpoints) {
    return errorPage('unsupported_connector', organizationId);
  }

  const app = resolveOauthAppCredentials(connectorSlug);
  if (!app) {
    const prefix = oauthAppEnvPrefix(connectorSlug);
    console.error(
      `[connectors:oauth2] no OAuth app configured for "${connectorSlug}": set ${prefix}CLIENT_ID and ${prefix}CLIENT_SECRET`,
    );
    return errorPage('not_configured', organizationId);
  }

  const exchange = await exchangeAuthorizationCode({
    tokenUrl: endpoints.tokenUrl,
    code,
    // The redirect URI the pending row recorded — byte-identical to the one the
    // authorize request carried, which is what vendors compare it against.
    redirectUri,
    clientId: app.clientId,
    clientSecret: app.clientSecret,
    codeVerifier,
  });
  if (!exchange.ok) {
    console.warn(
      `[connectors:oauth2] "${connectorSlug}" token exchange failed for organization ${organizationId}: ${exchange.reason}${
        exchange.code ? ` (${exchange.code})` : ''
      }`,
    );
    return errorPage(
      exchange.reason === 'vendor_rejected'
        ? 'vendor_declined'
        : 'vendor_unreachable',
      organizationId,
    );
  }
  const tokens = exchange.tokens;

  // Slack workspaces route inbound events by team id, and a workspace belongs
  // to one organization. Check before storing anything so a workspace already
  // connected elsewhere refuses cleanly instead of leaving an orphan
  // credential behind.
  if (tokens.teamId) {
    const existing = await ctx.runQuery(resolveTeamRouteRef, {
      teamId: tokens.teamId,
    });
    if (existing && existing.organizationId !== organizationId) {
      return errorPage('workspace_claimed', organizationId);
    }
  }

  let credentialId: string;
  try {
    const stored = await ctx.runAction(storeOauth2CredentialRef, {
      organizationId,
      connectorSlug,
      createdBy: userId,
      name: endpoints.displayName,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
    });
    credentialId = stored.credentialId;
  } catch (error) {
    // The message may embed the arguments we passed, which include the access
    // token — log the shape of the failure and the callee, never the error.
    console.error(
      `[connectors:oauth2] storing the "${connectorSlug}" credential for organization ${organizationId} failed via ${STORE_OAUTH2_CREDENTIAL_PATH} (${
        error instanceof Error ? error.name : 'unknown error'
      })`,
    );
    return errorPage('storage_failed', organizationId);
  }

  if (tokens.teamId) {
    const claim = await ctx.runMutation(claimTeamRouteRef, {
      teamId: tokens.teamId,
      organizationId,
      credentialId,
    });
    if (!claim.ok) {
      return errorPage('workspace_claimed', organizationId);
    }
  }

  const settingsUrl = resolveConnectorSettingsUrl(organizationId);
  if (!settingsUrl) {
    // Unreachable in practice: the pending row only exists because `start`
    // resolved a site URL. Refuse rather than invent a redirect target.
    return errorPage('not_configured');
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${settingsUrl}?connected=${encodeURIComponent(connectorSlug)}`,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
