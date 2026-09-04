import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { authorizeRls } from '../../auth/access.ts';
import type { Auth } from '../../auth/auth.ts';
import { isAdminRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  listMyThreadFeedback,
  getMyMessageFeedback,
  listMessageFeedback,
  removeMessageFeedback,
  submitMessageFeedback,
  getFeedbackStats,
  listRecentFeedbackPage,
} from './service.ts';

/**
 * A vote carries NO client metadata: the one-vote-per-(message, user) upsert
 * is arbitrated by the partial unique index `WHERE metadata IS NULL`, and the
 * `metadata.arenaVerdict` rows the analytics count as arena results are
 * written by the arena settle lane alone (`domains/chat/arena.ts`). Anything
 * else a client sends under `metadata` is dropped here, never stored.
 */
const submitSchema = z.object({
  threadId: z.string().min(1).max(200),
  messageId: z.string().min(1).max(200),
  rating: z.enum(['positive', 'negative']),
  comment: z.string().max(5000).optional(),
  agentSlug: z.string().max(100).optional(),
  model: z.string().max(200).optional(),
  provider: z.string().max(100).optional(),
});

/** /api/app/feedback — thumbs on assistant messages + the insights feed. */
export function createFeedbackRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const scopeOf = (c: Context<OrgEnv>) => ({
    organizationId: c.get('orgId'),
    userId: c.get('sessionBundle').user.id,
  });

  app.post('/', async (c) => {
    const body = submitSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const scope = scopeOf(c);
    await transactSerializable(deps.sql, (tx) =>
      submitMessageFeedback(tx, scope, body.data),
    );
    return c.json({ ok: true });
  });

  app.delete('/:messageId', async (c) => {
    const scope = scopeOf(c);
    await transactSerializable(deps.sql, (tx) =>
      removeMessageFeedback(tx, scope, c.req.param('messageId')),
    );
    return c.json({ ok: true });
  });

  app.get('/thread/:threadId', async (c) => {
    return c.json({
      feedback: await listMyThreadFeedback(
        deps.sql,
        scopeOf(c),
        c.req.param('threadId'),
      ),
    });
  });

  app.get('/mine/:messageId', async (c) => {
    return c.json({
      feedback: await getMyMessageFeedback(
        deps.sql,
        scopeOf(c),
        c.req.param('messageId'),
      ),
    });
  });

  // Org insights feed — role-gated by the matrix (members can read).
  app.get('/', async (c) => {
    if (!authorizeRls(c.get('orgMember').role, 'messageFeedback', 'read')) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const ratingParsed = z
      .enum(['positive', 'negative'])
      .safeParse(c.req.query('rating'));
    const options = ratingParsed.success ? { rating: ratingParsed.data } : {};
    return c.json(await listMessageFeedback(deps.sql, c.get('orgId'), options));
  });

  /** Metrics-page stats (the 0.4 `getFeedbackStats`; admin). */
  app.get('/stats', async (c) => {
    if (!isAdminRole(c.get('orgMember').role)) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const periodRaw = Number(c.req.query('periodDays') ?? Number.NaN);
    const periodDays =
      periodRaw === 1 || periodRaw === 7 || periodRaw === 30 || periodRaw === 90
        ? periodRaw
        : undefined;
    return c.json(
      await getFeedbackStats(deps.sql, c.get('orgId'), {
        ...(periodDays !== undefined ? { periodDays } : {}),
        ...(c.req.query('agentSlug') !== undefined
          ? { agentSlug: c.req.query('agentSlug') ?? '' }
          : {}),
        ...(c.req.query('model') !== undefined
          ? { model: c.req.query('model') ?? '' }
          : {}),
        ...(c.req.query('provider') !== undefined
          ? { provider: c.req.query('provider') ?? '' }
          : {}),
      }),
    );
  });

  /** Metrics-page recent-feedback page (the 0.4 `listRecentFeedback`). */
  app.get('/recent', async (c) => {
    if (!isAdminRole(c.get('orgMember').role)) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const periodRaw = Number(c.req.query('periodDays') ?? Number.NaN);
    const periodDays =
      periodRaw === 1 || periodRaw === 7 || periodRaw === 30 || periodRaw === 90
        ? periodRaw
        : undefined;
    const kindRaw = c.req.query('kind');
    const kind =
      kindRaw === 'all' || kindRaw === 'message' || kindRaw === 'arena'
        ? kindRaw
        : undefined;
    const cursorTs = Number(c.req.query('cursorTs') ?? Number.NaN);
    const cursorId = c.req.query('cursorId');
    const limitRaw = Number(c.req.query('limit') ?? '25');
    return c.json(
      await listRecentFeedbackPage(deps.sql, c.get('orgId'), {
        numItems: Number.isFinite(limitRaw) ? limitRaw : 25,
        cursor:
          Number.isFinite(cursorTs) && cursorId !== undefined
            ? { ts: cursorTs, id: cursorId }
            : null,
        ...(periodDays !== undefined ? { periodDays } : {}),
        ...(kind !== undefined ? { kind } : {}),
        ...(c.req.query('withCommentOnly') === 'true'
          ? { withCommentOnly: true }
          : {}),
        ...(c.req.query('agentSlug') !== undefined
          ? { agentSlug: c.req.query('agentSlug') ?? '' }
          : {}),
        ...(c.req.query('model') !== undefined
          ? { model: c.req.query('model') ?? '' }
          : {}),
        ...(c.req.query('provider') !== undefined
          ? { provider: c.req.query('provider') ?? '' }
          : {}),
      }),
    );
  });

  return app;
}
