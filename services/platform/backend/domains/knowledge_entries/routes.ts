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

/**
 * The listing's query string, coerced and bounded the way the contacts and
 * notifications listings do it. A `cursor` is a page key this listing issued
 * (a positive integer), `limit` the page size within the service's own cap.
 * Anything else is the caller's mistake and answers 400 — `Number('abc')`
 * used to ride into the SQL as NaN and surface as a 500.
 */
export const listQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  topic: z.string().max(500).optional(),
});

export function parseListQuery(raw: {
  cursor?: string;
  limit?: string;
  topic?: string;
}): ReturnType<typeof listQuerySchema.safeParse> {
  return listQuerySchema.safeParse(raw);
}

/** One line naming what was wrong, so the caller can fix the request. */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('; ');
}

const entryBodySchema = z.object({
  topic: z.string().max(500),
  content: z.string().max(20_000),
});

export function createKnowledgeEntryRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  app.get('/', async (c) => {
    const query = parseListQuery({
      cursor: c.req.query('cursor'),
      limit: c.req.query('limit'),
      topic: c.req.query('topic'),
    });
    if (!query.success) {
      return c.json(
        { error: 'invalid query', message: describeIssues(query.error) },
        400,
      );
    }
    return c.json(
      await listKnowledgeEntries(deps.sql, c.get('orgId'), query.data),
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
    // A body that is not JSON is the caller's mistake, not a server fault:
    // read it as `null` so the schema refuses it with a 400 like any other
    // malformed body, instead of the parse error escaping as a 500.
    const body = entryBodySchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json(
        { error: 'invalid body', message: describeIssues(body.error) },
        400,
      );
    }
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
    const body = entryBodySchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json(
        { error: 'invalid body', message: describeIssues(body.error) },
        400,
      );
    }
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
