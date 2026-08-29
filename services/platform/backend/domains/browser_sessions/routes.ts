import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  BrowserSessionError,
  importBrowserSession,
  listBrowserSessions,
} from './service.ts';

/**
 * /api/app/browser-sessions — the warmed-session pool surface (the 0.4
 * `browser_sessions` query + import action). Listing is org-member and
 * masked; the import write carries the 0.4 instance-admin + deployment
 * editor-allowlist gate inside the service.
 */

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof BrowserSessionError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}

export function createBrowserSessionRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  app.get('/', async (c) => {
    return c.json({
      sessions: await listBrowserSessions(deps.sql, c.get('orgId')),
    });
  });

  app.post('/import', async (c) => {
    const body = z
      .object({
        domain: z.string().min(1).max(255),
        cookiesJar: z.string().min(1).max(1_000_000),
        userAgent: z.string().max(512).optional(),
        visitorData: z.string().max(2048).optional(),
        poToken: z.string().max(4096).optional(),
        label: z.string().max(120).optional(),
        ttlMs: z.number().int().positive().optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      const result = await importBrowserSession(deps.sql, {
        callerUserId: c.get('sessionBundle').user.id,
        callerEmail: c.get('sessionBundle').user.email,
        organizationId: c.get('orgId'),
        ...body.data,
      });
      return c.json(result, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
