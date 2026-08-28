import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { getProjectAuthContext, listProjects } from '../projects/service.ts';
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

  return app;
}
