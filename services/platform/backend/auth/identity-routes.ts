import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { getString } from '../../lib/utils/type-utils.ts';
import type { Auth } from './auth.ts';
import { isAdminRole } from './membership.ts';
import { OIDC_SCOPES } from './oidc.ts';
import { requireOrgMember, type OrgEnv } from './org.ts';
import { requireSession } from './session.ts';

const clientInput = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    name: z.string().trim().min(1).max(100),
    redirectUri: z
      .string()
      .url()
      .max(2048)
      .refine((value) => {
        const url = new URL(value);
        const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(
          url.hostname,
        );
        return (
          !url.username &&
          !url.password &&
          !url.hash &&
          !url.search &&
          (url.protocol === 'https:' || (url.protocol === 'http:' && loopback))
        );
      }, 'Redirect URI must use HTTPS (HTTP is permitted on loopback only).'),
  })
  .strict();

/** Native client-secret lifecycle; every client belongs to exactly one org. */
export function createIdentityRoutes(deps: { sql: Sql; auth: Auth }) {
  const app = new Hono<OrgEnv>();
  app.use(bodyLimit({ maxSize: 8192 }));
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));
  app.use(async (c, next) => {
    if (c.req.method !== 'GET') {
      const origin = c.req.header('Origin');
      const trusted = deps.auth.options.trustedOrigins;
      if (!origin || !Array.isArray(trusted) || !trusted.includes(origin)) {
        return c.json({ error: 'INVALID_ORIGIN' }, 403);
      }
      if (c.req.header('Content-Type')?.split(';')[0] !== 'application/json') {
        return c.json({ error: 'JSON_REQUIRED' }, 415);
      }
    }
    if (!isAdminRole(c.get('orgMember').role)) {
      return c.json({ error: 'ORG_ADMIN_REQUIRED' }, 403);
    }
    // Better Auth's clientReference binds to the native active organization.
    // Require equality rather than changing the caller's session as a side effect.
    if (
      c.get('sessionBundle').session.activeOrganizationId !== c.get('orgId')
    ) {
      return c.json({ error: 'ACTIVE_ORGANIZATION_REQUIRED' }, 409);
    }
    c.header('Cache-Control', 'no-store');
    return next();
  });

  app.get('/clients', async (c) =>
    c.json({
      clients: await deps.auth.api.getOAuthClients({
        headers: c.req.raw.headers,
      }),
    }),
  );

  app.post('/clients', async (c) => {
    const input = clientInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'INVALID_CLIENT' }, 400);
    const { key, name, redirectUri } = input.data;
    const organizationId = c.get('orgId');
    // The native adapter uses its own pool. A transaction-scoped org lock
    // serializes this wrapper across replicas while native APIs own all writes.
    return deps.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`oidc-client:${organizationId}`}, 0))`;
      const clients =
        (await deps.auth.api.getOAuthClients({ headers: c.req.raw.headers })) ??
        [];
      const existing = clients.filter((client) => client.software_id === key);
      if (existing.length > 1)
        return c.json({ error: 'CLIENT_KEY_AMBIGUOUS' }, 409);
      const found = existing[0];
      if (found) {
        if (
          found.redirect_uris?.length !== 1 ||
          found.redirect_uris[0] !== redirectUri ||
          found.client_name !== name ||
          found.disabled ||
          !found.require_pkce ||
          found.skip_consent ||
          found.token_endpoint_auth_method !== 'client_secret_post' ||
          found.grant_types?.join(' ') !== 'authorization_code' ||
          found.response_types?.join(' ') !== 'code' ||
          found.scope
            ?.split(' ')
            .sort((a, b) => a.localeCompare(b))
            .join(' ') !==
            [...OIDC_SCOPES].sort((a, b) => a.localeCompare(b)).join(' ') ||
          getString(found, 'taleOrganizationId') !== organizationId
        ) {
          return c.json({ error: 'CLIENT_CONFIGURATION_CONFLICT' }, 409);
        }
        return c.json({ created: false, client: found });
      }
      if (clients.length >= 100)
        return c.json({ error: 'CLIENT_LIMIT_REACHED' }, 409);
      const client = await deps.auth.api.adminCreateOAuthClient({
        headers: c.req.raw.headers,
        body: {
          client_name: name,
          software_id: key,
          redirect_uris: [redirectUri],
          scope: OIDC_SCOPES.join(' '),
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post',
          type: 'web',
          require_pkce: true,
          skip_consent: false,
          metadata: { taleOrganizationId: organizationId },
        },
      });
      return c.json({ created: true, client }, 201);
    });
  });
  const clientKey = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
  app.post('/clients/:key/rotate-secret', async (c) => {
    if (
      !clientKey.safeParse(c.req.param('key')).success ||
      !z
        .object({})
        .strict()
        .safeParse(await c.req.json().catch(() => null)).success
    ) {
      return c.json({ error: 'INVALID_CLIENT' }, 400);
    }
    const clients =
      (await deps.auth.api.getOAuthClients({ headers: c.req.raw.headers })) ??
      [];
    const matches = clients.filter(
      (client) => client.software_id === c.req.param('key'),
    );
    const matched = matches.length === 1 ? matches[0] : undefined;
    if (!matched) return c.json({ error: 'CLIENT_NOT_FOUND' }, 404);
    return c.json(
      await deps.auth.api.rotateClientSecret({
        headers: c.req.raw.headers,
        body: { client_id: matched.client_id },
      }),
    );
  });
  app.post('/clients/:key/status', async (c) => {
    const input = z
      .object({ disabled: z.boolean() })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!clientKey.safeParse(c.req.param('key')).success || !input.success)
      return c.json({ error: 'INVALID_CLIENT' }, 400);
    const clients =
      (await deps.auth.api.getOAuthClients({ headers: c.req.raw.headers })) ??
      [];
    const matches = clients.filter(
      (client) => client.software_id === c.req.param('key'),
    );
    const matched = matches.length === 1 ? matches[0] : undefined;
    if (!matched) return c.json({ error: 'CLIENT_NOT_FOUND' }, 404);
    // The maintained provider exposes the disabled flag in its schema, but
    // its admin-update HTTP/API input deliberately omits it. Use the same
    // native adapter after resolving one client owned by this organization.
    const { adapter } = await deps.auth.$context;
    const updated = await adapter.update({
      model: 'oauthClient',
      where: [{ field: 'clientId', value: matched.client_id }],
      update: { disabled: input.data.disabled, updatedAt: new Date() },
    });
    if (!updated) return c.json({ error: 'CLIENT_NOT_FOUND' }, 404);
    return c.json({
      client_id: matched.client_id,
      disabled: input.data.disabled,
    });
  });
  return app;
}
