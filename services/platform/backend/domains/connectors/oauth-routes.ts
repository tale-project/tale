import { Hono } from 'hono';
import type { Sql } from 'postgres';

import {
  CONSENT_CONFIG_PARAM,
  decodeConsentConfig,
  RECONNECT_CREDENTIAL_PARAM,
} from '../../../lib/shared/connector-consent.ts';
import type { Auth } from '../../auth/auth.ts';
import {
  sessionAllowsOrganization,
  sessionOrganizationId,
} from '../../auth/session-authority.ts';
import {
  requireSession,
  type AuthEnv,
  type SessionBundle,
} from '../../auth/session.ts';
import {
  resolveConnectorSettingsUrl,
  resolvePublicBaseUrl,
} from '../../core/http_connectors/deployment_config.ts';
import { renderConnectorErrorPage } from '../../core/http_connectors/error_page.ts';
import { publicOrigin } from '../../core/lib/helpers/public_origin.ts';
import { completeOauth2, connectorWriteAccess, startOauth2 } from './oauth.ts';

/** Longer than any id a credential row carries — a probe, not a Reconnect. */
const CREDENTIAL_ID_MAX = 128;

/**
 * `/api/connectors/oauth2` — the browser-facing halves of the connector
 * consent flow (the 0.4 `http_connectors` HTTP actions).
 *
 * `start` is session-gated: it must know WHO is asking and that their role
 * may add credentials to the named organization — connecting a connector IS
 * a credential write, just spelled as a consent flow — and it refuses a
 * navigation from another site (`Sec-Fetch-Site: cross-site`), so a link
 * elsewhere cannot start one with settings of its choosing. It also takes the
 * consent's intent (`lib/shared/connector-consent.ts`): no `credentialId`
 * adds a new credential, with the settings `config` carries, a
 * `credentialId` reconnects that one (an OAuth grant of this organization
 * and connector, or the flow does not start). `callback` is authorized by the single-use state
 * row, which carries the organization, the connector and that intent —
 * nothing in the callback request can move them — AND bound to the session
 * on the returning browser: the completer must be the member who started the
 * flow, so a forwarded consent link cannot land a stranger's vendor grant in
 * the initiator's organization, and must still hold the role `start` checked.
 * A completion without that session gets the same page as a forged state
 * (not a JSON 401): a person is looking at this in a browser tab.
 *
 * Both answer HTML error pages rather than JSON: a person is looking at this
 * in a browser tab, mid-flow, and needs a way back to settings.
 */
export function createConnectorOauthRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  /** The error page's "back to settings" link stays on the domain the
   * browser is on — `base` is that origin's public base when known. */
  const errorPage = (
    kind: Parameters<typeof renderConnectorErrorPage>[0],
    organizationId?: string,
    base: string | null = null,
    acceptLanguage = '',
  ): Response =>
    renderConnectorErrorPage(
      kind,
      organizationId === undefined
        ? null
        : resolveConnectorSettingsUrl(
            organizationId,
            base ?? resolvePublicBaseUrl(),
          ),
      acceptLanguage,
    );

  const plainText = (body: string, status: 401 | 403): Response =>
    new Response(body, {
      status,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        // The answer depends on the session cookie; a caching proxy keying
        // only on the URL would serve one user's outcome to another.
        Vary: 'Cookie',
      },
    });

  app.get('/start', requireSession(deps.auth), async (c) => {
    const connectorSlug = c.req.query('connector') ?? '';
    const organizationId = c.req.query('organizationId') ?? '';
    // Absent: an Add. Present, it must name something — an empty or absurd
    // id is a broken Reconnect link, never quietly read as an Add.
    const credentialId = c.req.query(RECONNECT_CREDENTIAL_PARAM);
    // An Add's settings. Present, they must be readable: a link that lost
    // them is refused, never started as a credential without them.
    const rawConfig = c.req.query(CONSENT_CONFIG_PARAM);
    if (connectorSlug === '' || organizationId === '') {
      return errorPage('unsupported_connector');
    }
    const userId = c.get('sessionBundle').user.id;
    if (
      !sessionAllowsOrganization(c.get('sessionBundle').session, organizationId)
    ) {
      return plainText('You do not have access to this organization.', 403);
    }
    const access = await connectorWriteAccess(deps.sql, organizationId, userId);
    if (access === 'not_member') {
      // Same answer for "no such organization" and "not your organization":
      // the difference only helps someone enumerating org ids.
      return plainText('You do not have access to this organization.', 403);
    }
    if (access === 'role_forbidden') {
      return plainText(
        'Your role cannot connect connectors for this organization.',
        403,
      );
    }

    // The consent flow returns to the domain it started on: the session
    // cookie the callback needs lives there, not on the canonical origin.
    const origin = publicOrigin(c.req.raw);
    // A connection starts from Tale's own pages, which navigate here from
    // the same origin; a typed address carries no Sec-Fetch-Site at all.
    // A link on another site still carries the Lax session cookie, and
    // would otherwise start an Add with the settings the link chose — a
    // mailbox the member can open, sent to the vendor in one click. The
    // callback is never guarded: the vendor sends the browser back to it.
    if (c.req.header('sec-fetch-site') === 'cross-site') {
      console.warn(
        `[connectors:oauth2] refused a "${connectorSlug}" start opened from another site (organization ${organizationId})`,
      );
      return errorPage(
        'cross_site_start',
        organizationId,
        resolvePublicBaseUrl(origin),
        c.req.header('accept-language'),
      );
    }
    if (
      credentialId !== undefined &&
      (credentialId.length === 0 || credentialId.length > CREDENTIAL_ID_MAX)
    ) {
      return errorPage(
        'credential_missing',
        organizationId,
        resolvePublicBaseUrl(origin),
        c.req.header('accept-language'),
      );
    }
    const config =
      rawConfig === undefined ? undefined : decodeConsentConfig(rawConfig);
    if (config === null) {
      console.warn(
        `[connectors:oauth2] refused a "${connectorSlug}" start whose settings are not readable (organization ${organizationId})`,
      );
      return errorPage(
        'invalid_settings',
        organizationId,
        resolvePublicBaseUrl(origin),
        c.req.header('accept-language'),
      );
    }
    const outcome = await startOauth2(deps.sql, {
      connectorSlug,
      organizationId,
      userId,
      ...(credentialId !== undefined
        ? { reconnectCredentialId: credentialId }
        : {}),
      ...(config !== undefined ? { config } : {}),
      publicOrigin: origin,
    });
    if (outcome.kind === 'error') {
      return errorPage(
        outcome.error,
        organizationId,
        resolvePublicBaseUrl(origin),
        c.req.header('accept-language'),
      );
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: outcome.url,
        // The URL carries the state token; keep it out of every cache.
        'Cache-Control': 'no-store',
        // The start URL names the organization — do not hand it to the
        // vendor as a referrer.
        'Referrer-Policy': 'no-referrer',
        Vary: 'Cookie',
      },
    });
  });

  app.get('/callback', async (c) => {
    const cached = await deps.auth.api.getSession({
      headers: c.req.raw.headers,
    });
    const session: SessionBundle | null =
      cached === null ? null : await deps.auth.resolveSessionAuthority(cached);
    const outcome = await completeOauth2(deps.sql, {
      state: c.req.query('state') ?? null,
      code: c.req.query('code') ?? null,
      vendorError: c.req.query('error') ?? null,
      requesterUserId: session?.user.id ?? null,
      requesterOrganizationId:
        session === null
          ? null
          : (sessionOrganizationId(session.session) ?? null),
    });
    if (outcome.kind === 'error') {
      return errorPage(
        outcome.error,
        outcome.organizationId ??
          session?.session.activeOrganizationId ??
          undefined,
        resolvePublicBaseUrl(publicOrigin(c.req.raw)),
        c.req.header('accept-language'),
      );
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${outcome.settingsUrl}?connected=${encodeURIComponent(outcome.connectorSlug)}`,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    });
  });

  return app;
}
