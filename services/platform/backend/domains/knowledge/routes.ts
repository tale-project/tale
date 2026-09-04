import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import { knowledgeConnectionSchema } from '../../../lib/shared/schemas/knowledge.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { FETCH_WINDOW_CHARS, windowText } from '../../core/knowledge/fetch.ts';
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

  // Every body here reads as `null` when it is not JSON, so the schema
  // refuses it with the same 400 as any other malformed body — a parse error
  // escaping the handler used to surface as a 500.
  app.post('/search', async (c) => {
    const body = searchSchema.safeParse(await c.req.json().catch(() => null));
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
    const body = fetchSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const { access } = await callerScope(c);
      const document = await fetchKnowledgeDocument(deps.sql, {
        organizationId: c.get('orgId'),
        fileId: body.data.fileId,
        access,
      });
      const page = body.data.page;
      if (document === null || page === undefined) {
        return c.json({ document });
      }
      // `page` is a 1-based window of FETCH_WINDOW_CHARS over the text — the
      // paging contract every rag_fetch surface shares. Accepted-and-ignored
      // was worse than absent: a caller asking for page 2 got the whole
      // document again and no way to tell.
      const window = windowText(
        document.text,
        (page - 1) * FETCH_WINDOW_CHARS,
        FETCH_WINDOW_CHARS,
      );
      return c.json({
        document: { ...document, text: window.content },
        page,
        totalPages: Math.max(
          1,
          Math.ceil(window.totalChars / FETCH_WINDOW_CHARS),
        ),
        totalChars: window.totalChars,
      });
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
  // The wire shape of a BYO knowledge connection is the SHARED field schemas
  // (host charset, port range, the full sslmode set the picker offers —
  // `verify-ca` included) in a strip-mode object: strictness is the config
  // FILE's policy, not the request body's. A hand-rolled second copy of the
  // enum is exactly how `verify-ca` went missing here and every save or test
  // with it died as a bare "invalid body".
  const connectionBodySchema = z.object({
    ...knowledgeConnectionSchema.shape,
    password: z.string().max(2_000).nullable().optional(),
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
    const body = connectionBodySchema.safeParse(
      await c.req.json().catch(() => null),
    );
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
    const body = connectionBodySchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    const { password, ...connection } = body.data;
    try {
      return c.json(
        await probeKnowledgeConnection({
          connection,
          ...(password !== undefined ? { password } : {}),
          orgSlug,
        }),
      );
    } catch (error) {
      return handleAdminError(c, error);
    }
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
