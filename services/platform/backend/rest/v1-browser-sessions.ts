import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  importBrowserSession,
  listBrowserSessions,
} from '../domains/browser_sessions/service.ts';
import { domainErrorResponse, type RestEnv } from './shared.ts';

/**
 * The /browser-sessions REST family — the operator door to the warmed
 * browser-session pool behind the video-link ingest's bot-wall mitigation
 * (domains/browser_sessions/service.ts). The pool has no in-app surface: an
 * operator captures a cookie jar from a browser that cleared the target
 * platform's challenge and imports it here; the ingest then claims sessions
 * for that domain LRU-style, cools the ones that get blocked, and the sweep
 * retires them.
 *
 * Listing is org-member and masked (never the jar). The import carries the
 * instance-admin + deployment editor-allowlist gate inside the service — the
 * key acts as its user, so exactly the operators who may repoint the
 * deployment's data stores may seed its cookie pool.
 */

const importBody = z.object({
  domain: z.string().min(1).max(255),
  cookiesJar: z.string().min(1).max(1_000_000),
  userAgent: z.string().max(512).optional(),
  visitorData: z.string().max(2048).optional(),
  poToken: z.string().max(4096).optional(),
  label: z.string().max(120).optional(),
  ttlMs: z.number().int().positive().optional(),
});

export function createRestBrowserSessionRoutes(deps: {
  sql: Sql;
}): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  app.get('/browser-sessions', async (c) => {
    return c.json({
      sessions: await listBrowserSessions(deps.sql, c.get('organizationId')),
    });
  });

  app.post('/browser-sessions/import', async (c) => {
    const body = importBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json(
        { error: 'invalid body ("domain" and "cookiesJar" are required)' },
        400,
      );
    }
    try {
      const result = await importBrowserSession(deps.sql, {
        callerUserId: c.get('userId'),
        callerEmail: c.get('userEmail'),
        organizationId: c.get('organizationId'),
        ...body.data,
      });
      return c.json(result, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  return app;
}
