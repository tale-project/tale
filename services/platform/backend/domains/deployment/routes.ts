import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireSession, type AuthEnv } from '../../auth/session.ts';
import {
  DeploymentError,
  requireInstanceAdmin,
  readDeploymentConfigView,
  saveDeploymentConfig,
} from './service.ts';

/**
 * /api/app/deployment — INSTANCE-level operator settings (no org scope;
 * the caller's own memberships decide access). Reads: any org-settings
 * admin. Writes: additionally gated on the deployment editor allowlist.
 */
function handleError<E extends AuthEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof DeploymentError) {
    return c.json(
      { ...error.data, error: error.code, message: error.message },
      error.status,
    );
  }
  throw error;
}

export function createDeploymentRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.use(requireSession(deps.auth));

  const caller = (c: Context<AuthEnv>): { id: string; email: string } => ({
    id: c.get('sessionBundle').user.id,
    email: c.get('sessionBundle').user.email,
  });

  app.get('/config', async (c) => {
    try {
      const auth = await requireInstanceAdmin(deps.sql, caller(c));
      return c.json(await readDeploymentConfigView(auth));
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/config', async (c) => {
    const body = z
      .object({
        config: z.unknown(),
        expectedHash: z.string().max(200).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      const auth = await requireInstanceAdmin(deps.sql, caller(c), {
        write: true,
      });
      return c.json(
        await saveDeploymentConfig(deps.sql, auth, {
          config: body.data.config,
          ...(body.data.expectedHash !== undefined
            ? { expectedHash: body.data.expectedHash }
            : {}),
        }),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
