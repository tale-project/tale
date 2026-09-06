import { Hono } from 'hono';
import type { Sql } from 'postgres';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { Auth } from '../../auth/auth.ts';
import {
  MembershipError,
  requireOrganizationMember,
} from '../../auth/membership.ts';
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
import { completeOauth2, startOauth2 } from './oauth.ts';

/**
 * `/api/connectors/oauth2` — the browser-facing halves of the connector
 * consent flow (the 0.4 `http_connectors` HTTP actions).
 *
 * `start` is session-gated: it must know WHO is asking and that their role
 * may add credentials to the named organization — connecting a connector IS
 * a credential write, just spelled as a consent flow. `callback` is
 * authorized by the single-use state row, which carries the organization the
 * credential is written for — nothing in the callback request can move it —
 * AND bound to the session on the returning browser: the completer must be
 * the member who started the flow, so a forwarded consent link cannot land a
 * stranger's vendor grant in the initiator's organization. A completion
 * without that session gets the same page as a forged state (not a JSON
 * 401): a person is looking at this in a browser tab.
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
  ): Response =>
    renderConnectorErrorPage(
      kind,
      organizationId === undefined
        ? null
        : resolveConnectorSettingsUrl(
            organizationId,
            base ?? resolvePublicBaseUrl(),
          ),
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
    if (connectorSlug === '' || organizationId === '') {
      return errorPage('unsupported_connector');
    }
    const userId = c.get('sessionBundle').user.id;
    let role: string;
    try {
      role = (await requireOrganizationMember(deps.sql, organizationId, userId))
        .role;
    } catch (error) {
      if (error instanceof MembershipError) {
        // Same answer for "no such organization" and "not your organization":
        // the difference only helps someone enumerating org ids.
        return plainText('You do not have access to this organization.', 403);
      }
      throw error;
    }
    if (defineAbilityFor(role).cannot('read', 'developerSettings')) {
      return plainText(
        'Your role cannot connect connectors for this organization.',
        403,
      );
    }

    // The consent flow returns to the domain it started on: the session
    // cookie the callback needs lives there, not on the canonical origin.
    const origin = publicOrigin(c.req.raw);
    const outcome = await startOauth2(deps.sql, {
      connectorSlug,
      organizationId,
      userId,
      publicOrigin: origin,
    });
    if (outcome.kind === 'error') {
      return errorPage(
        outcome.error,
        organizationId,
        resolvePublicBaseUrl(origin),
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
    const session: SessionBundle | null = await deps.auth.api.getSession({
      headers: c.req.raw.headers,
    });
    const outcome = await completeOauth2(deps.sql, {
      state: c.req.query('state') ?? null,
      code: c.req.query('code') ?? null,
      vendorError: c.req.query('error') ?? null,
      requesterUserId: session?.user.id ?? null,
    });
    if (outcome.kind === 'error') {
      return errorPage(
        outcome.error,
        outcome.organizationId,
        resolvePublicBaseUrl(publicOrigin(c.req.raw)),
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
