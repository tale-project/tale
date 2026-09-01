import { Hono } from 'hono';
import type { Sql } from 'postgres';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { Auth } from '../../auth/auth.ts';
import {
  MembershipError,
  requireOrganizationMember,
} from '../../auth/membership.ts';
import { requireSession, type AuthEnv } from '../../auth/session.ts';
import { resolveConnectorSettingsUrl } from '../../core/http_connectors/deployment_config.ts';
import { renderConnectorErrorPage } from '../../core/http_connectors/error_page.ts';
import { completeOauth2, startOauth2 } from './oauth.ts';

/**
 * `/api/connectors/oauth2` — the browser-facing halves of the connector
 * consent flow (the 0.4 `http_connectors` HTTP actions).
 *
 * `start` is session-gated: it must know WHO is asking and that their role
 * may add credentials to the named organization — connecting a connector IS
 * a credential write, just spelled as a consent flow. `callback` is
 * deliberately NOT session-gated: the vendor redirects the browser back and
 * the only thing that authorizes it is the single-use state row, which
 * carries the organization the credential is written for. Nothing in the
 * callback request can move it.
 *
 * Both answer HTML error pages rather than JSON: a person is looking at this
 * in a browser tab, mid-flow, and needs a way back to settings.
 */
export function createConnectorOauthRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  const errorPage = (
    kind: Parameters<typeof renderConnectorErrorPage>[0],
    organizationId?: string,
  ): Response =>
    renderConnectorErrorPage(
      kind,
      organizationId === undefined
        ? null
        : resolveConnectorSettingsUrl(organizationId),
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

    const outcome = await startOauth2(deps.sql, {
      connectorSlug,
      organizationId,
      userId,
    });
    if (outcome.kind === 'error') {
      return errorPage(outcome.error, organizationId);
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
    const outcome = await completeOauth2(deps.sql, {
      state: c.req.query('state') ?? null,
      code: c.req.query('code') ?? null,
      vendorError: c.req.query('error') ?? null,
    });
    if (outcome.kind === 'error') {
      return errorPage(outcome.error, outcome.organizationId);
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
