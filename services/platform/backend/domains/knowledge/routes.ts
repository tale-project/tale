import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { getProjectAuthContext, listProjects } from '../projects/service.ts';
import { listCredentials } from '../provider_credentials/service.ts';
import {
  KnowledgeAdminError,
  deleteKnowledgeConnection,
  deleteKnowledgeEmbedding,
  listEmbeddingRecommendationsForOrg,
  probeKnowledgeConnection,
  readKnowledgeConnectionView,
  readKnowledgeEmbeddingView,
  writeKnowledgeConnection,
  writeKnowledgeEmbedding,
} from './admin.ts';
import {
  fetchKnowledgeDocument,
  KnowledgeError,
  searchKnowledgeForOrg,
} from './service.ts';

const searchSchema = z.object({
  query: z.string().min(1).max(2000),
  corpus: z.enum(['documents', 'web', 'all']).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  folder: z.string().max(1024).optional(),
});

const fetchSchema = z.object({
  fileId: z.string().min(1).max(1024),
  page: z.number().int().min(1).optional(),
});

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof KnowledgeError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}

/**
 * /api/app/knowledge — retrieval for the signed-in surface. The access
 * scope is derived SERVER-SIDE from the caller's memberships (their teams +
 * the projects they can read + the hub), never from client input.
 */
export function createKnowledgeRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const callerScope = async (c: Context<OrgEnv>) => {
    const auth = await getProjectAuthContext(
      deps.sql,
      {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
        role: c.get('orgMember').role,
      },
      c.get('sessionBundle').user.email,
    );
    const projects = await listProjects(deps.sql, auth, {});
    return {
      auth,
      access: {
        userId: auth.userId,
        teamIds: auth.teamIds,
        projectIds: projects.map((project) => project.id),
        includeHub: true,
        includeConversationScoped: false,
      },
    };
  };

  app.post('/search', async (c) => {
    const body = searchSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const { access } = await callerScope(c);
      const result = await searchKnowledgeForOrg(deps.sql, {
        organizationId: c.get('orgId'),
        query: body.data.query,
        ...(body.data.corpus !== undefined ? { corpus: body.data.corpus } : {}),
        ...(body.data.limit !== undefined ? { limit: body.data.limit } : {}),
        ...(body.data.folder !== undefined ? { folder: body.data.folder } : {}),
        access,
      });
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/fetch', async (c) => {
    const body = fetchSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const { access } = await callerScope(c);
      const document = await fetchKnowledgeDocument(deps.sql, {
        organizationId: c.get('orgId'),
        fileId: body.data.fileId,
        ...(body.data.page !== undefined ? { page: body.data.page } : {}),
        access,
      });
      return c.json({ document });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // ---- Admin config (data-residency page): connection + embedding -------
  const requireKnowledgeAdmin = (c: Context<OrgEnv>): Response | null => {
    if (
      defineAbilityFor(c.get('orgMember').role).cannot('write', 'orgSettings')
    ) {
      return c.json(
        {
          error: 'ORG_FORBIDDEN',
          message: `Role "${c.get('orgMember').role}" cannot manage the knowledge configuration.`,
        },
        403,
      );
    }
    return null;
  };
  const orgSlugOf = async (c: Context<OrgEnv>): Promise<string | null> =>
    resolveOrgSlug(deps.sql, c.get('orgId'));
  const handleAdminError = (c: Context<OrgEnv>, error: unknown): Response => {
    if (error instanceof KnowledgeAdminError) {
      return c.json(
        { error: error.code, message: error.message },
        error.status,
      );
    }
    throw error;
  };
  const connectionSchema = z.object({
    host: z.string().min(1).max(500),
    port: z.number().int().min(1).max(65_535),
    database: z.string().min(1).max(200),
    user: z.string().min(1).max(200),
    sslmode: z.enum(['disable', 'prefer', 'require', 'verify-full']),
  });

  app.get('/connection', async (c) => {
    const denied = requireKnowledgeAdmin(c);
    if (denied) return denied;
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    return c.json(await readKnowledgeConnectionView(orgSlug));
  });

  app.post('/connection', async (c) => {
    const denied = requireKnowledgeAdmin(c);
    if (denied) return denied;
    const body = connectionSchema
      .extend({ password: z.string().max(2_000).nullable().optional() })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    const { password, ...connection } = body.data;
    try {
      await writeKnowledgeConnection(orgSlug, {
        connection,
        ...(password !== undefined ? { password } : {}),
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleAdminError(c, error);
    }
  });

  app.delete('/connection', async (c) => {
    const denied = requireKnowledgeAdmin(c);
    if (denied) return denied;
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    await deleteKnowledgeConnection(orgSlug);
    return c.json({ ok: true });
  });

  app.post('/connection/test', async (c) => {
    const denied = requireKnowledgeAdmin(c);
    if (denied) return denied;
    const body = connectionSchema
      .extend({ password: z.string().max(2_000).nullable().optional() })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    const { password, ...connection } = body.data;
    return c.json(
      await probeKnowledgeConnection({
        connection,
        ...(password !== undefined ? { password } : {}),
        orgSlug,
      }),
    );
  });

  app.get('/embedding', async (c) => {
    const denied = requireKnowledgeAdmin(c);
    if (denied) return denied;
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    return c.json(await readKnowledgeEmbeddingView(orgSlug));
  });

  app.post('/embedding', async (c) => {
    const denied = requireKnowledgeAdmin(c);
    if (denied) return denied;
    const body: unknown = await c.req.json().catch(() => null);
    if (body === null) return c.json({ error: 'invalid body' }, 400);
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    try {
      await writeKnowledgeEmbedding(orgSlug, body);
      return c.json({ ok: true });
    } catch (error) {
      return handleAdminError(c, error);
    }
  });

  app.delete('/embedding', async (c) => {
    const denied = requireKnowledgeAdmin(c);
    if (denied) return denied;
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    await deleteKnowledgeEmbedding(orgSlug);
    return c.json({ ok: true });
  });

  app.get('/embedding/recommendations', async (c) => {
    const denied = requireKnowledgeAdmin(c);
    if (denied) return denied;
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    const session = c.get('sessionBundle');
    const credentials = await listCredentials(deps.sql, {
      organizationId: c.get('orgId'),
      userId: session.user.id,
      email: session.user.email,
      role: c.get('orgMember').role,
    });
    return c.json({
      recommendations: await listEmbeddingRecommendationsForOrg(
        orgSlug,
        credentials,
      ),
    });
  });

  return app;
}
