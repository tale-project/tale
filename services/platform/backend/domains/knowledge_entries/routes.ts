import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  checkOrganizationRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import {
  countKnowledgeEntries,
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  getKnowledgeEntryVersions,
  KnowledgeEntryError,
  listKnowledgeEntries,
  updateKnowledgeEntry,
} from './service.ts';

/** /api/app/knowledge-entries — the manual entries tab (member surface). */
function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof KnowledgeEntryError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  if (error instanceof RateLimitExceededError) {
    return c.json({ error: 'RATE_LIMITED' }, 429, {
      'retry-after': String(Math.ceil(error.retryAfter / 1000)),
    });
  }
  throw error;
}

export function createKnowledgeEntryRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  app.get('/', async (c) => {
    const cursorRaw = c.req.query('cursor');
    const limitRaw = c.req.query('limit');
    const topic = c.req.query('topic');
    return c.json(
      await listKnowledgeEntries(deps.sql, c.get('orgId'), {
        ...(cursorRaw !== undefined ? { cursor: Number(cursorRaw) } : {}),
        ...(limitRaw !== undefined ? { limit: Number(limitRaw) } : {}),
        ...(topic !== undefined ? { topic } : {}),
      }),
    );
  });

  app.get('/count', async (c) => {
    return c.json({
      count: await countKnowledgeEntries(deps.sql, c.get('orgId')),
    });
  });

  app.get('/:entryId/versions', async (c) => {
    return c.json({
      versions: await getKnowledgeEntryVersions(
        deps.sql,
        c.get('orgId'),
        c.req.param('entryId'),
      ),
    });
  });

  app.post('/', async (c) => {
    const body = z
      .object({ topic: z.string().max(500), content: z.string().max(20_000) })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await checkOrganizationRateLimit(
        deps.sql,
        'knowledge:mutate',
        c.get('orgId'),
      );
      const id = await createKnowledgeEntry(deps.sql, {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
        role: c.get('orgMember').role,
        topic: body.data.topic,
        content: body.data.content,
      });
      return c.json({ id }, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:entryId', async (c) => {
    const body = z
      .object({ topic: z.string().max(500), content: z.string().max(20_000) })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await checkOrganizationRateLimit(
        deps.sql,
        'knowledge:mutate',
        c.get('orgId'),
      );
      const id = await updateKnowledgeEntry(deps.sql, {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
        role: c.get('orgMember').role,
        entryId: c.req.param('entryId'),
        topic: body.data.topic,
        content: body.data.content,
      });
      return c.json({ id });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/:entryId', async (c) => {
    try {
      await deleteKnowledgeEntry(deps.sql, {
        organizationId: c.get('orgId'),
        entryId: c.req.param('entryId'),
        role: c.get('orgMember').role,
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
