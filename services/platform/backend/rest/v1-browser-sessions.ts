import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  assertBrowserSessionImporter,
  deleteBrowserSession,
  importBrowserSession,
  listBrowserSessions,
  MAX_SESSION_TTL_MS,
} from '../domains/browser_sessions/service.ts';
import {
  domainErrorResponse,
  noQuery,
  notFound,
  parseBody,
  type RestEnv,
} from './shared.ts';

/**
 * The /browser-sessions REST family — the operator door to the warmed
 * browser-session pool behind the video-link ingest's bot-wall mitigation
 * (domains/browser_sessions/service.ts). The pool has no in-app surface: an
 * operator captures a cookie jar from a browser that cleared the target
 * platform's challenge and imports it here; the ingest then claims sessions
 * for that domain LRU-style, cools the ones that get blocked, and the sweep
 * retires them.
 *
 * Listing is org-member and masked (never the jar). The import and the
 * delete sit behind the instance-admin + deployment editor-allowlist gate
 * (`assertBrowserSessionImporter`) — the key acts as its user, so exactly
 * the operators who may repoint the deployment's data stores may seed or
 * revoke its cookie pool — and the gate runs BEFORE the body is read: a
 * caller about to be refused gets no schema feedback first.
 */

const importBody = z.strictObject({
  domain: z.string().trim().min(1).max(255),
  cookiesJar: z.string().trim().min(1).max(1_000_000),
  userAgent: z.string().max(512).optional(),
  visitorData: z.string().max(2048).optional(),
  poToken: z.string().max(4096).optional(),
  label: z.string().max(120).optional(),
  ttlMs: z.number().int().positive().max(MAX_SESSION_TTL_MS).optional(),
});

export function createRestBrowserSessionRoutes(deps: {
  sql: Sql;
}): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  app.get('/browser-sessions', noQuery, async (c) => {
    return c.json({
      sessions: await listBrowserSessions(deps.sql, c.get('organizationId')),
    });
  });

  /** Null when the key holder may write to the pool; the 403 otherwise. */
  const importerRefusal = async (c: Context<RestEnv>) => {
    try {
      await assertBrowserSessionImporter(deps.sql, {
        callerUserId: c.get('userId'),
        callerEmail: c.get('userEmail'),
      });
      return null;
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  };

  app.post('/browser-sessions/import', async (c) => {
    const refused = await importerRefusal(c);
    if (refused) return refused;
    const body = await parseBody(c, importBody);
    if (body instanceof Response) return body;
    try {
      const result = await importBrowserSession(deps.sql, {
        callerUserId: c.get('userId'),
        callerEmail: c.get('userEmail'),
        organizationId: c.get('organizationId'),
        ...body,
      });
      return c.json(result, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.delete('/browser-sessions/:id', async (c) => {
    const refused = await importerRefusal(c);
    if (refused) return refused;
    const deleted = await deleteBrowserSession(deps.sql, {
      organizationId: c.get('organizationId'),
      sessionId: c.req.param('id'),
    });
    if (!deleted) {
      return notFound(
        c,
        'Browser session not found',
        'BROWSER_SESSION_NOT_FOUND',
      );
    }
    return c.body(null, 204);
  });

  return app;
}
