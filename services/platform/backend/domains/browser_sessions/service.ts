import type { Sql, TransactionSql } from 'postgres';

import { decideInstanceAdmin } from '../../core/deployment/auth_policy.ts';
import { encryptString } from '../../core/lib/crypto/encrypt_string.ts';

/**
 * Browser-session pool — the 0.5 twin of `convex/browser_sessions`: warmed
 * per-(org, domain) cookie jars the video-link ingest claims LRU-style so
 * reach-outs rotate through the pool. A blocked outcome cools the session
 * (3 strikes expires it); the 10-min sweep recovers cooled sessions after
 * a quiet period and prunes long-expired rows. Jars are JWE-encrypted at
 * rest (the reused `encryptString`) and never returned by any read.
 */

export class BrowserSessionError extends Error {
  readonly code: string;
  readonly status: 400 | 401 | 403 | 404;

  constructor(
    code: string,
    message: string,
    status: 400 | 401 | 403 | 404 = 400,
  ) {
    super(message);
    this.name = 'BrowserSessionError';
    this.code = code;
    this.status = status;
  }
}

export const DEFAULT_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_SESSION_FAILURES = 3;
const COOLING_RECOVERY_MS = 30 * 60 * 1000;
const EXPIRED_PRUNE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ClaimedBrowserSession {
  sessionId: string;
  cookiesEncrypted: string;
  userAgent?: string;
  visitorData?: string;
  poToken?: string;
}

/**
 * Atomically claim the least-recently-used healthy session for the
 * (org, domain) — stamps `last_used_at_ms` so concurrent reach-outs rotate
 * through the pool. `null` when none is available (the reach-out proceeds
 * without one — an env proxy / PO provider still applies).
 */
export async function claimBrowserSession(
  sql: Sql,
  args: { organizationId: string; domain: string },
): Promise<ClaimedBrowserSession | null> {
  const now = Date.now();
  return sql.begin(async (tx) => {
    const rows = await tx<
      {
        id: string;
        cookiesEncrypted: string;
        userAgent: string | null;
        visitorData: string | null;
        poToken: string | null;
      }[]
    >`
      SELECT id, cookies_encrypted AS "cookiesEncrypted",
             user_agent AS "userAgent", visitor_data AS "visitorData",
             po_token AS "poToken"
      FROM app.browser_sessions
      WHERE org_id = ${args.organizationId} AND domain = ${args.domain}
        AND status = 'healthy' AND expires_at_ms > ${now}
      ORDER BY last_used_at_ms ASC NULLS FIRST
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    const row = rows[0];
    if (!row) return null;
    await tx`
      UPDATE app.browser_sessions SET last_used_at_ms = ${now}
      WHERE id = ${row.id}
    `;
    return {
      sessionId: row.id,
      cookiesEncrypted: row.cookiesEncrypted,
      ...(row.userAgent !== null ? { userAgent: row.userAgent } : {}),
      ...(row.visitorData !== null ? { visitorData: row.visitorData } : {}),
      ...(row.poToken !== null ? { poToken: row.poToken } : {}),
    };
  });
}

/** Record a reach-out's outcome: `ok` resets the failure streak; `blocked`
 * cools the session, and the third strike expires it. */
export async function reportBrowserSessionResult(
  sql: Sql | TransactionSql,
  args: { sessionId: string; outcome: 'ok' | 'blocked' },
): Promise<void> {
  if (args.outcome === 'ok') {
    await sql`
      UPDATE app.browser_sessions SET failure_count = 0
      WHERE id = ${args.sessionId} AND failure_count > 0
    `;
    return;
  }
  await sql`
    UPDATE app.browser_sessions SET
      failure_count = failure_count + 1,
      status = CASE
        WHEN failure_count + 1 >= ${MAX_SESSION_FAILURES} THEN 'expired'
        ELSE 'cooling'
      END
    WHERE id = ${args.sessionId}
  `;
}

/**
 * Import a warmed jar (the 0.4 instance-admin-gated action): the caller
 * must administer some org AND — for this write — be on the
 * `TALE_DEPLOYMENT_CONFIG_ADMINS` editor allowlist (the reused pure
 * `decideInstanceAdmin`). The jar is encrypted before it touches the row.
 */
export async function importBrowserSession(
  sql: Sql,
  args: {
    callerUserId: string;
    callerEmail?: string;
    organizationId: string;
    domain: string;
    cookiesJar: string;
    userAgent?: string;
    visitorData?: string;
    poToken?: string;
    label?: string;
    ttlMs?: number;
  },
): Promise<{ sessionId: string }> {
  const members = await sql<{ organizationId: string; role: string }[]>`
    SELECT "organizationId", "role" FROM "member"
    WHERE "userId" = ${args.callerUserId}
    LIMIT 50
  `;
  const decision = decideInstanceAdmin({
    email: args.callerEmail,
    members,
    write: true,
  });
  if (!decision.ok) {
    throw new BrowserSessionError(
      decision.code,
      decision.code === 'FORBIDDEN_INSTANCE_ADMIN'
        ? 'Browser-session import is restricted to organization administrators.'
        : 'Your account is not on the deployment editor allowlist (TALE_DEPLOYMENT_CONFIG_ADMINS).',
      403,
    );
  }

  const jar = args.cookiesJar.trim();
  const domain = args.domain.trim().toLowerCase();
  const organizationId = args.organizationId.trim();
  if (!jar || !domain || !organizationId) {
    throw new BrowserSessionError(
      'INVALID_SESSION',
      'A domain, an organizationId, and a non-empty cookie jar are required.',
    );
  }
  const cookiesEncrypted = await encryptString(jar);
  const rows = await sql<{ id: string }[]>`
    INSERT INTO app.browser_sessions (
      org_id, domain, cookies_encrypted, user_agent, visitor_data, po_token,
      label, status, source, expires_at_ms, failure_count, created_by,
      created_at_ms
    ) VALUES (
      ${organizationId}, ${domain}, ${cookiesEncrypted},
      ${args.userAgent ?? null}, ${args.visitorData ?? null},
      ${args.poToken ?? null}, ${args.label ?? null}, 'healthy', 'imported',
      ${Date.now() + (args.ttlMs ?? DEFAULT_SESSION_TTL_MS)}, 0,
      ${args.callerUserId}, ${Date.now()}
    )
    RETURNING id
  `;
  const sessionId = rows[0]?.id;
  if (!sessionId) throw new Error('browser session insert failed');
  return { sessionId };
}

/** Masked per-org listing for the operator UI — never the cookies. */
export async function listBrowserSessions(
  sql: Sql,
  organizationId: string,
): Promise<
  {
    id: string;
    domain: string;
    label: string | null;
    status: string;
    expiresAt: number;
    lastUsedAt: number | null;
    failureCount: number;
  }[]
> {
  return sql<
    {
      id: string;
      domain: string;
      label: string | null;
      status: string;
      expiresAt: number;
      lastUsedAt: number | null;
      failureCount: number;
    }[]
  >`
    SELECT id, domain, label, status, expires_at_ms::float8 AS "expiresAt",
           last_used_at_ms::float8 AS "lastUsedAt",
           failure_count AS "failureCount"
    FROM app.browser_sessions
    WHERE org_id = ${organizationId}
    ORDER BY domain ASC, created_at_ms ASC
  `;
}

/** The 10-min sweep (the 0.4 cron): expire past-TTL rows, recover cooled
 * ones whose quiet period elapsed, prune long-expired rows. */
export async function sweepBrowserSessions(sql: Sql): Promise<void> {
  const now = Date.now();
  await sql`
    UPDATE app.browser_sessions SET status = 'expired'
    WHERE status IN ('healthy', 'cooling') AND expires_at_ms <= ${now}
  `;
  await sql`
    UPDATE app.browser_sessions SET status = 'healthy', failure_count = 0
    WHERE status = 'cooling'
      AND coalesce(last_used_at_ms, 0) + ${COOLING_RECOVERY_MS} < ${now}
  `;
  await sql`
    DELETE FROM app.browser_sessions
    WHERE status = 'expired' AND expires_at_ms + ${EXPIRED_PRUNE_MS} < ${now}
  `;
}
