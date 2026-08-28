import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { authorizeRls } from '../../auth/access.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  getMyMessageFeedback,
  listMessageFeedback,
  removeMessageFeedback,
  submitMessageFeedback,
} from './service.ts';

const submitSchema = z.object({
  threadId: z.string().min(1).max(200),
  messageId: z.string().min(1).max(200),
  rating: z.enum(['positive', 'negative']),
  comment: z.string().max(5000).optional(),
  agentSlug: z.string().max(100).optional(),
  model: z.string().max(200).optional(),
  provider: z.string().max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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

  return app;
}
