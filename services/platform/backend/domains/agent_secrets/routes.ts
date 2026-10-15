import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { isAdminOrDeveloperRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  invalidBodyIssuesResponse,
  invalidBodyResponse,
} from '../../lib/invalid-body-response.ts';
import {
  managedAgentSecretWriteSchema,
  readManagedAgentSecret,
  writeManagedAgentSecret,
} from './managed.ts';
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

  // The 0.4 listing fails CLOSED TO EMPTY for non-developers (the equipment
  // picker renders for every project admin), so only the writes 403.
  app.get('/', async (c) => {
    if (!isAdminOrDeveloperRole(c.get('orgMember').role)) {
      return c.json({ secrets: [] });
    }
    return c.json({
      secrets: await listAgentSecrets(deps.sql, c.get('orgId')),
    });
  });

  app.use(async (c, next) => {
    if (!isAdminOrDeveloperRole(c.get('orgMember').role)) {
      return c.json({ error: 'admin or developer role required' }, 403);
    }
    return next();
  });

  app.post('/', async (c) => {
    const body = z
      .object({
        name: z.string().min(1).max(200),
        value: z.string().min(1).max(10_000),
        description: z.string().max(500).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return invalidBodyResponse(c, body.error);
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

  // A secret as managed configuration declares it (`agent-secret`), named
  // in the query: its name and the digest of its value, never the value.
  app.get('/configuration', async (c) => {
    const target = z
      .strictObject({
        name: z.string().min(1).max(200),
        createIfMissing: z.literal('true').optional(),
      })
      .safeParse({
        name: c.req.query('name'),
        createIfMissing: c.req.query('createIfMissing'),
      });
    if (!target.success) return invalidBodyResponse(c, target.error);
    try {
      return c.json(
        await readManagedAgentSecret(
          deps.sql,
          c.get('orgId'),
          target.data.name,
          target.data.createIfMissing === 'true',
        ),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/configuration', async (c) => {
    const body = managedAgentSecretWriteSchema.safeParse(await c.req.json());
    if (!body.success) return invalidBodyResponse(c, body.error);
    if (body.data.name !== c.req.query('name'))
      return invalidBodyIssuesResponse(c, [
        { path: 'name', message: 'must name the secret in the query' },
      ]);
    try {
      await writeManagedAgentSecret(deps.sql, {
        ...body.data,
        organizationId: c.get('orgId'),
        actorId: c.get('sessionBundle').user.id,
        actorEmail: c.get('sessionBundle').user.email,
      });
      return c.json({ ok: true });
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
