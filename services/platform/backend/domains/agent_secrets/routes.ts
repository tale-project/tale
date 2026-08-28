import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { isAdminOrDeveloperRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  AgentSecretError,
  deleteAgentSecret,
  listAgentSecrets,
  upsertAgentSecret,
} from './service.ts';

/**
 * /api/app/agent-secrets — the org secrets manager (developer-gated, like
 * the 0.4 surface). Values are write-only; listings carry only the masked
 * preview and description.
 */
function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof AgentSecretError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}

export function createAgentSecretRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));
  app.use(async (c, next) => {
    if (!isAdminOrDeveloperRole(c.get('orgMember').role)) {
      return c.json({ error: 'admin or developer role required' }, 403);
    }
    return next();
  });

  app.get('/', async (c) => {
    return c.json({
      secrets: await listAgentSecrets(deps.sql, c.get('orgId')),
    });
  });

  app.post('/', async (c) => {
    const body = z
      .object({
        name: z.string().min(1).max(200),
        value: z.string().min(1).max(10_000),
        description: z.string().max(500).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      return c.json(
        await upsertAgentSecret(deps.sql, {
          organizationId: c.get('orgId'),
          actorId: c.get('sessionBundle').user.id,
          actorEmail: c.get('sessionBundle').user.email,
          name: body.data.name,
          value: body.data.value,
          ...(body.data.description !== undefined
            ? { description: body.data.description }
            : {}),
        }),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/:name', async (c) => {
    try {
      await deleteAgentSecret(deps.sql, {
        organizationId: c.get('orgId'),
        actorId: c.get('sessionBundle').user.id,
        actorEmail: c.get('sessionBundle').user.email,
        name: c.req.param('name'),
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
