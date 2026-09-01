import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { listConnectorSummaries } from '../../core/connector_credentials/connector_catalog.ts';
import { resolveOauthAppCredentials } from '../../core/http_connectors/deployment_config.ts';
import { listOauthApps } from '../connectors/oauth-apps.ts';
import {
  ConnectorCredentialError,
  createCredential,
  deleteCredential,
  getCredential,
  listCredentials,
  setDefaultCredential,
  updateCredential,
} from './service.ts';

/**
 * /api/app/connector-credentials — the settings surface. Reads under plain
 * org membership; writes behind the developer-settings capability (the same
 * gate the 0.4 mutations applied). Responses carry masked previews only —
 * plaintext never leaves the service's resolve seam.
 */

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof ConnectorCredentialError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}

const secretInput = z.object({
  token: z.string().max(8192).optional(),
  username: z.string().max(512).optional(),
  password: z.string().max(8192).optional(),
  smtpUsername: z.string().max(512).optional(),
  smtpPassword: z.string().max(8192).optional(),
  accessToken: z.string().max(8192).optional(),
  refreshToken: z.string().max(8192).optional(),
  expiresAt: z.number().optional(),
  scopes: z.array(z.string().max(256)).max(64).optional(),
});

const configInput = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);

export function createConnectorCredentialRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const requireDeveloper = (c: Context<OrgEnv>): Response | null => {
    if (
      defineAbilityFor(c.get('orgMember').role).cannot(
        'read',
        'developerSettings',
      )
    ) {
      return c.json(
        { error: 'The developer capability is required here.' },
        403,
      );
    }
    return null;
  };

  /** The connector CATALOG (settings rows) — the shipped file summaries,
   * overlaid with each OAuth2 connector's app state (org row / deployment
   * env / none) so the UI can gate Connect on it. Developer gate matching
   * the 0.4 action. */
  app.get('/catalog', async (c) => {
    const denied = requireDeveloper(c);
    if (denied) return denied;
    const orgAppSlugs = new Set(
      (await listOauthApps(deps.sql, c.get('orgId'))).map((row) => row.slug),
    );
    const connectors = listConnectorSummaries().map((summary) => {
      if (!summary.authMethods.includes('oauth2')) return summary;
      const source = orgAppSlugs.has(summary.slug)
        ? ('org' as const)
        : resolveOauthAppCredentials(summary.slug) !== null
          ? ('env' as const)
          : null;
      return Object.assign({}, summary, {
        oauthApp: { configured: source !== null, source },
      });
    });
    return c.json({ connectors });
  });

  app.get('/', async (c) => {
    const connectorSlug = c.req.query('connector') ?? undefined;
    return c.json({
      credentials: await listCredentials(
        deps.sql,
        c.get('orgId'),
        connectorSlug,
      ),
    });
  });

  app.get('/:id', async (c) => {
    try {
      return c.json(
        await getCredential(deps.sql, c.get('orgId'), c.req.param('id')),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/', async (c) => {
    const refused = requireDeveloper(c);
    if (refused) return refused;
    const body = z
      .object({
        connectorSlug: z.string().min(1).max(100),
        authMethod: z.enum(['api-key', 'bearer', 'basic', 'oauth2']),
        name: z.string().min(1).max(100),
        secret: secretInput,
        endpointUrl: z.string().max(512).optional(),
        config: configInput.optional(),
        isDefault: z.boolean().optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      const created = await createCredential(deps.sql, {
        ...body.data,
        organizationId: c.get('orgId'),
        createdBy: c.get('sessionBundle').user.id,
      });
      return c.json(created, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.patch('/:id', async (c) => {
    const refused = requireDeveloper(c);
    if (refused) return refused;
    const body = z
      .object({
        name: z.string().min(1).max(100).optional(),
        secret: secretInput.optional(),
        endpointUrl: z.string().max(512).optional(),
        config: configInput.optional(),
        status: z.enum(['active', 'disabled', 'needs-reauth']).optional(),
        statusDetail: z.string().max(512).nullable().optional(),
        isDefault: z.boolean().optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await updateCredential(deps.sql, {
        ...body.data,
        organizationId: c.get('orgId'),
        credentialId: c.req.param('id'),
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:id/set-default', async (c) => {
    const refused = requireDeveloper(c);
    if (refused) return refused;
    try {
      await setDefaultCredential(deps.sql, c.get('orgId'), c.req.param('id'));
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/:id', async (c) => {
    const refused = requireDeveloper(c);
    if (refused) return refused;
    try {
      await deleteCredential(deps.sql, c.get('orgId'), c.req.param('id'));
      return c.body(null, 204);
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
