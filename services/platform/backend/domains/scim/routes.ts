import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import { AppError } from '../../../lib/shared/errors/app-error';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  resourceTypes,
  schemas,
  serviceProviderConfig,
} from '../../core/scim/discovery.ts';
import {
  generateScimToken,
  hashScimToken,
  scimTokenPrefix,
} from '../../core/scim/helpers/crypto.ts';
import {
  scimGroupResourceImpl,
  scimGroupsImpl,
  scimUserResourceImpl,
  scimUsersImpl,
  type ScimRc,
} from '../../core/scim/http_actions.ts';
import {
  SCIM_CORS_HEADERS,
  scimError,
  scimJson,
} from '../../core/scim/responses.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { ssoShimHandlers } from '../sso/shim.ts';
import {
  disableScim,
  getConfigByTokenHash,
  getScimStatus,
  regenerateScimToken,
  touchConfigLastUsed,
} from './service.ts';
import { scimShimHandlers } from './shim.ts';

/**
 * /scim/v2 — the SCIM 2.0 service-provider door, the REUSED 0.4 dispatcher
 * bodies whole (Users/Groups CRUD + PATCH + filters + discovery) on the SCIM
 * shim. Bearer-token auth resolves the tenant from the `app.sso_connections`
 * hash row — org is NEVER read from the body or path. Plus the admin token
 * surface (`/api/app/scim`): status / regenerate / disable, orgSettings-gated.
 */

export function createScimRoutes(deps: { sql: Sql }): Hono {
  const app = new Hono();

  const buildRc = (organizationId: string, defaultRole: string): ScimRc => {
    const ctx = createCtxShim({
      ...ssoShimHandlers(deps.sql),
      ...scimShimHandlers(deps.sql),
    });
    return {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 handlers; every ctx facility they touch is covered by the shim handlers
      ctx: ctx as unknown as ScimRc['ctx'],
      organizationId,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the connection file's zod schema pins the role vocabulary
      defaultRole: defaultRole as ScimRc['defaultRole'],
    };
  };

  const withAuth =
    (impl: (rc: ScimRc, req: Request) => Promise<Response>) =>
    async (c: Context): Promise<Response> => {
      const header = c.req.header('authorization') ?? '';
      if (!header.toLowerCase().startsWith('bearer ')) {
        return scimError(401, 'Missing or invalid Authorization header');
      }
      const token = header.slice('bearer '.length).trim();
      if (!token) return scimError(401, 'Empty bearer token');
      const tokenHash = await hashScimToken(token);
      const config = await getConfigByTokenHash(deps.sql, tokenHash);
      if (!config || !config.enabled) {
        return scimError(401, 'Invalid or revoked SCIM token');
      }
      await touchConfigLastUsed(deps.sql, config.configId);
      try {
        return await impl(
          buildRc(config.organizationId, config.defaultRole),
          c.req.raw,
        );
      } catch (error) {
        // A coded AppError from the provisioning layer maps to its SCIM
        // status — a cross-tenant create collision is a 409, not a 500.
        if (error instanceof AppError && isRecord(error.data)) {
          const data = error.data;
          if (data.code === 'scim_user_conflict') {
            const detail =
              typeof data.message === 'string'
                ? data.message
                : 'User already exists';
            return scimError(409, detail, 'uniqueness');
          }
        }
        console.error('[scim] handler error', error);
        return scimError(500, 'Internal server error');
      }
    };

  app.options('/*', () => {
    return new Response(null, { status: 204, headers: SCIM_CORS_HEADERS });
  });

  app.get(
    '/ServiceProviderConfig',
    withAuth(async () => scimJson(serviceProviderConfig())),
  );
  app.get(
    '/ResourceTypes',
    withAuth(async () => scimJson(resourceTypes(scimPublicBase()))),
  );
  app.get(
    '/Schemas',
    withAuth(async () => scimJson(schemas())),
  );

  app.all('/Users', withAuth(scimUsersImpl));
  app.all('/Users/:id', withAuth(scimUserResourceImpl));
  app.all('/Groups', withAuth(scimGroupsImpl));
  app.all('/Groups/:id', withAuth(scimGroupResourceImpl));

  return app;
}

/** Public SCIM base for `meta.location` — undefined when SITE_URL is unset. */
function scimPublicBase(): string | undefined {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) return undefined;
  const basePath = process.env.BASE_PATH ?? '';
  return `${siteUrl.replace(/\/$/, '')}${basePath}/http_api/scim/v2`;
}

/** /api/app/scim — the admin token surface. */
export function createScimAdminRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const requireAdmin = (c: Context<OrgEnv>): Response | null => {
    if (
      defineAbilityFor(c.get('orgMember').role).cannot('write', 'orgSettings')
    ) {
      return c.json({ error: 'Only admins can manage SCIM provisioning' }, 403);
    }
    return null;
  };

  app.get('/', async (c) => {
    const refused = requireAdmin(c);
    if (refused) return refused;
    return c.json(await getScimStatus(deps.sql, c.get('orgId')));
  });

  /** Generate (or rotate) the bearer token — plaintext answered ONCE. */
  app.post('/regenerate-token', async (c) => {
    const refused = requireAdmin(c);
    if (refused) return refused;
    const token = generateScimToken();
    const result = await regenerateScimToken(deps.sql, {
      organizationId: c.get('orgId'),
      actorId: c.get('sessionBundle').user.id,
      actorEmail: c.get('sessionBundle').user.email,
      token,
      tokenHash: await hashScimToken(token),
      tokenPrefix: scimTokenPrefix(token),
    });
    return c.json({
      token,
      tokenPrefix: scimTokenPrefix(token),
      rotated: result.rotated,
    });
  });

  app.post('/disable', async (c) => {
    const refused = requireAdmin(c);
    if (refused) return refused;
    const body = z.object({}).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    await disableScim(deps.sql, {
      organizationId: c.get('orgId'),
      actorId: c.get('sessionBundle').user.id,
      actorEmail: c.get('sessionBundle').user.email,
    });
    return c.json({ ok: true });
  });

  return app;
}
