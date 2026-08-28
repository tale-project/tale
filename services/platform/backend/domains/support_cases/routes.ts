import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  addSupportCaseComment,
  archiveSupportCase,
  assignSupportCase,
  createSupportCase,
  escalateSupportCase,
  getSupportCase,
  listSupportCases,
  SUPPORT_CASE_COMMENT_MAX,
  SUPPORT_CASE_PRIORITIES,
  SUPPORT_CASE_STATUSES,
  SupportCaseError,
  updateSupportCaseStatus,
  type SupportScope,
} from './service.ts';

const createSchema = z.object({
  subject: z.string().min(1).max(500),
  description: z.string().max(50_000).optional(),
  priority: z.enum(SUPPORT_CASE_PRIORITIES).optional(),
  contactId: z.string().optional(),
  requesterEmail: z.string().email().max(320).optional(),
  requesterName: z.string().max(200).optional(),
  slaDueAt: z.number().int().positive().optional(),
});

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof SupportCaseError) {
    return c.json({ error: error.code }, error.status);
  }
  throw error;
}

/** /api/app/support-cases — the customer support portal. */
export function createSupportCaseRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const scopeOf = (c: Context<OrgEnv>): SupportScope => ({
    organizationId: c.get('orgId'),
    userId: c.get('sessionBundle').user.id,
    email: c.get('sessionBundle').user.email,
  });

  app.get('/', async (c) => {
    try {
      const status = c.req.query('status');
      const parsed = z.enum(SUPPORT_CASE_STATUSES).safeParse(status);
      return c.json({
        cases: await listSupportCases(deps.sql, scopeOf(c), {
          ...(parsed.success ? { status: parsed.data } : {}),
          includeArchived: c.req.query('includeArchived') === 'true',
        }),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/', async (c) => {
    const body = createSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const scope = scopeOf(c);
      const caseId = await transactSerializable(deps.sql, (tx) =>
        createSupportCase(tx, scope, body.data),
      );
      return c.json({ caseId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:caseId', async (c) => {
    try {
      return c.json(
        await getSupportCase(deps.sql, scopeOf(c), c.req.param('caseId')),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:caseId/status', async (c) => {
    const body = z
      .object({ status: z.enum(SUPPORT_CASE_STATUSES) })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const scope = scopeOf(c);
      await transactSerializable(deps.sql, (tx) =>
        updateSupportCaseStatus(
          tx,
          scope,
          c.req.param('caseId'),
          body.data.status,
        ),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:caseId/assign', async (c) => {
    const body = z
      .object({
        assigneeType: z.enum(['user', 'agent']).optional(),
        assigneeId: z.string().optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const assignee =
      body.data.assigneeType !== undefined && body.data.assigneeId
        ? {
            assigneeType: body.data.assigneeType,
            assigneeId: body.data.assigneeId,
          }
        : null;
    try {
      const scope = scopeOf(c);
      await transactSerializable(deps.sql, (tx) =>
        assignSupportCase(tx, scope, c.req.param('caseId'), assignee),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:caseId/escalate', async (c) => {
    try {
      const scope = scopeOf(c);
      const level = await transactSerializable(deps.sql, (tx) =>
        escalateSupportCase(tx, scope, c.req.param('caseId')),
      );
      return c.json({ escalationLevel: level });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:caseId/comments', async (c) => {
    const body = z
      .object({
        body: z.string().min(1).max(SUPPORT_CASE_COMMENT_MAX),
        internal: z.boolean().optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const scope = scopeOf(c);
      const commentId = await transactSerializable(deps.sql, (tx) =>
        addSupportCaseComment(tx, scope, {
          caseId: c.req.param('caseId'),
          ...body.data,
        }),
      );
      return c.json({ commentId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:caseId/archive', async (c) => {
    try {
      const scope = scopeOf(c);
      await transactSerializable(deps.sql, (tx) =>
        archiveSupportCase(tx, scope, c.req.param('caseId')),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
