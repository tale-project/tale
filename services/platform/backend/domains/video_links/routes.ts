import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { checkOrganizationRateLimit } from '../../lib/rate-limit.ts';
import {
  bindCompletedJobsToMessage,
  cancelVideoLink,
  ingestVideoUrl,
  listForThread,
  listUnboundForUser,
  retryVideoLink,
  unbindJobsFromMessage,
  VideoLinkError,
} from './service.ts';

/**
 * /api/app/video-links — the chat composer's video-link chips (the 0.4
 * `video_links` mutations/queries). Org-member gated; a supplied thread
 * must be the caller's own (chips live in the sender's composer — the
 * same gate the send lane applies).
 */

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof VideoLinkError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}

async function assertOwnThread(
  sql: Sql,
  organizationId: string,
  userId: string,
  threadId: string,
): Promise<void> {
  const rows = await sql<{ id: string }[]>`
    SELECT t.id FROM app.threads t
    JOIN app.thread_metadata tm ON tm.thread_id = t.id
    WHERE t.id = ${threadId} AND t.org_id = ${organizationId}
      AND t.user_id = ${userId} AND tm.status = 'active'
    LIMIT 1
  `;
  if (rows.length === 0) {
    throw new VideoLinkError('threadNotFound', 'Thread not found', 404);
  }
}

export function createVideoLinkRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  app.post('/ingest', async (c) => {
    const body = z
      .object({
        url: z.string().min(1).max(4096),
        pastedToken: z.string().min(1).max(4096),
        threadId: z.string().max(200).optional(),
        userLocale: z.string().max(35).optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      const userId = c.get('sessionBundle').user.id;
      if (body.data.threadId !== undefined) {
        await assertOwnThread(
          deps.sql,
          c.get('orgId'),
          userId,
          body.data.threadId,
        );
      }
      await checkOrganizationRateLimit(deps.sql, 'file:upload', c.get('orgId'));
      const jobId = await ingestVideoUrl(deps.sql, {
        organizationId: c.get('orgId'),
        userId,
        ...(body.data.threadId !== undefined
          ? { threadId: body.data.threadId }
          : {}),
        url: body.data.url,
        pastedToken: body.data.pastedToken,
        ...(body.data.userLocale !== undefined
          ? { userLocale: body.data.userLocale }
          : {}),
      });
      return c.json({ jobId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/thread/:threadId', async (c) => {
    try {
      await assertOwnThread(
        deps.sql,
        c.get('orgId'),
        c.get('sessionBundle').user.id,
        c.req.param('threadId'),
      );
      return c.json({
        jobs: await listForThread(
          deps.sql,
          c.get('orgId'),
          c.req.param('threadId'),
        ),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/unbound', async (c) => {
    return c.json({
      jobs: await listUnboundForUser(
        deps.sql,
        c.get('orgId'),
        c.get('sessionBundle').user.id,
      ),
    });
  });

  app.post('/bind', async (c) => {
    const body = z
      .object({ threadId: z.string().min(1).max(200) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await assertOwnThread(
        deps.sql,
        c.get('orgId'),
        c.get('sessionBundle').user.id,
        body.data.threadId,
      );
      return c.json({
        attachments: await bindCompletedJobsToMessage(deps.sql, {
          organizationId: c.get('orgId'),
          userId: c.get('sessionBundle').user.id,
          threadId: body.data.threadId,
        }),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/unbind', async (c) => {
    const body = z
      .object({ jobIds: z.array(z.string().min(1)).max(50) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    await unbindJobsFromMessage(deps.sql, {
      userId: c.get('sessionBundle').user.id,
      jobIds: body.data.jobIds,
    });
    return c.json({ ok: true });
  });

  app.post('/:jobId/cancel', async (c) => {
    try {
      await cancelVideoLink(deps.sql, {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
        jobId: c.req.param('jobId'),
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:jobId/retry', async (c) => {
    try {
      await retryVideoLink(deps.sql, {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
        jobId: c.req.param('jobId'),
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
