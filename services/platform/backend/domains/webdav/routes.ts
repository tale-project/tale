import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import { functionRefName } from '../../../lib/shared/handlers/function-refs.ts';
import { fetchAdapter } from '../../../lib/webdav/adapters/fetch.ts';
import type { WebDAVCtx } from '../../../lib/webdav/types.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  generateAppPasswordSecret,
  hmacHash,
  requireHmacSecret,
} from '../../core/webdav/helpers.ts';
import { rateLimitedResponse } from '../../lib/rate-limit-response.ts';
import {
  checkOrganizationRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import { webdavHandlers } from './handlers.ts';

/**
 * The WebDAV re-home: the REUSED `lib/webdav` protocol layer (RFC 4918
 * dispatch, Basic-auth verify, PROPFIND/GET/PUT/MKCOL/DELETE/MOVE/COPY/
 * LOCK/UNLOCK method handlers) served by the backend at `/dav/<orgSlug>/…`,
 * with its ConvexHttpClient replaced by a name-keyed shim over the PG
 * handlers — the same dispatch idea as `lib/ctx-shim.ts`, at the
 * client's `.query/.mutation/.action` surface (the protocol layer addresses
 * functions through the name proxy, so `functionRefName` yields the same
 * `path/module:export` names the handler map keys on; an unmapped name
 * fails loud).
 *
 * Plus the app-password admin surface (`/api/app/webdav/app-passwords`):
 * create is developer-gated (PAT-equivalent credentials), list/revoke are
 * ownership-gated — a user revoking their own credential after losing role
 * privileges must still succeed.
 */

const MAX_ACTIVE_APP_PASSWORDS_PER_USER = 50;

function buildWebdavCtx(sql: Sql): WebDAVCtx {
  const handlers = webdavHandlers(sql);
  const call = async (ref: unknown, args: unknown): Promise<unknown> => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the protocol layer only passes anyApi references
    const name = functionRefName(ref);
    const handler = handlers[name];
    if (!handler) {
      throw new Error(`[webdav-shim] un-shimmed function: ${name}`);
    }
    return handler(args);
  };
  const shim = {
    query: call,
    mutation: call,
    action: call,
  };
  return { backend: shim };
}

/** `/dav/*` — the protocol surface. Auth is HTTP Basic inside the reused
 * dispatch (app passwords), NOT the session middleware. */
export function createWebdavProtocolRoutes(deps: { sql: Sql }): Hono {
  const app = new Hono();
  const ctx = buildWebdavCtx(deps.sql);
  app.all('*', (c) => fetchAdapter(c.req.raw, ctx));
  return app;
}

// ------------------------------------------------------- admin surface

export function createWebdavAdminRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  app.get('/app-passwords', async (c) => {
    const userId = c.get('sessionBundle').user.id;
    const rows = await deps.sql<
      {
        _id: string;
        label: string;
        prefix: string;
        createdAt: number;
        lastUsedAt: number | null;
        revokedAt: number | null;
      }[]
    >`
      SELECT id AS "_id", label, password_prefix AS "prefix",
             created_at_ms::float8 AS "createdAt",
             last_used_at_ms::float8 AS "lastUsedAt",
             revoked_at_ms::float8 AS "revokedAt"
      FROM app.webdav_app_passwords
      WHERE org_id = ${c.get('orgId')} AND user_id = ${userId}
    `;
    return c.json({ appPasswords: rows });
  });

  app.post('/app-passwords', async (c) => {
    // PAT-equivalent credentials: gate creation on the developer
    // capability so member/editor roles cannot mint credentials that
    // outlive their session scope (the 0.4 rule).
    if (
      defineAbilityFor(c.get('orgMember').role).cannot(
        'read',
        'developerSettings',
      )
    ) {
      return c.json({ error: 'FORBIDDEN' }, 403);
    }
    const body = z
      .object({ label: z.string().min(1).max(64) })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'INVALID_LABEL' }, 400);
    const organizationId = c.get('orgId');
    const userId = c.get('sessionBundle').user.id;
    try {
      await checkOrganizationRateLimit(
        deps.sql,
        'webdav:app-password-create',
        organizationId,
        1,
      );
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        return rateLimitedResponse(c, error);
      }
      throw error;
    }
    const active = await deps.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.webdav_app_passwords
      WHERE org_id = ${organizationId} AND user_id = ${userId}
        AND revoked_at_ms IS NULL
    `;
    if (Number(active[0]?.count ?? '0') >= MAX_ACTIVE_APP_PASSWORDS_PER_USER) {
      return c.json({ error: 'LIMIT_EXCEEDED' }, 429);
    }
    const secret = generateAppPasswordSecret();
    const passwordHashed = await hmacHash(secret, requireHmacSecret());
    const passwordPrefix = secret.slice(0, 4);
    await deps.sql`
      INSERT INTO app.webdav_app_passwords (
        org_id, user_id, label, password_prefix, password_hashed,
        created_at_ms
      ) VALUES (
        ${organizationId}, ${userId}, ${body.data.label.trim()},
        ${passwordPrefix}, ${passwordHashed}, ${Date.now()}
      )
    `;
    // Plaintext ONCE — never read back.
    return c.json({ password: secret, prefix: passwordPrefix }, 201);
  });

  app.post('/app-passwords/:id/revoke', async (c) => {
    const userId = c.get('sessionBundle').user.id;
    const rows = await deps.sql<{ id: string; revokedAt: number | null }[]>`
      SELECT id, revoked_at_ms::float8 AS "revokedAt"
      FROM app.webdav_app_passwords
      WHERE id = ${c.req.param('id')} AND user_id = ${userId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return c.json({ error: 'NOT_FOUND' }, 404);
    if (row.revokedAt !== null) return c.json({ ok: true });
    await deps.sql.begin(async (tx) => {
      await tx`
        UPDATE app.webdav_app_passwords
        SET revoked_at_ms = ${Date.now()}
        WHERE id = ${row.id}
      `;
      // Force-release any live locks held under this credential — the
      // documented recovery path when a client crashed mid-edit.
      await tx`
        DELETE FROM app.webdav_locks WHERE app_password_id = ${row.id}
      `;
    });
    return c.json({ ok: true });
  });

  return app;
}
