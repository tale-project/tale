import { Hono } from 'hono';
import type { Sql } from 'postgres';

import { resolveTeams } from '../../../convex/betterAuth/trusted_headers/resolve_team_names.ts';
import { signCookieValue } from '../../../convex/enterprise_sso/sign_cookie_value.ts';
import { parseTeamsHeader } from '../../../convex/trusted_headers_auth/authenticate_handler.ts';
import { sessionExpiryMs } from '../../../lib/shared/session-idle.ts';
import { sanitizeInternalRedirect } from '../../../lib/shared/utils/safe-redirect.ts';
import { createAuditLog } from '../audit_logs/service.ts';

/**
 * Trusted-headers authentication — the 0.5 twin of
 * `trusted_headers_auth/authenticate_handler.ts` +
 * `betterAuth/trusted_headers/*`: an authenticating reverse proxy
 * (Authelia, Authentik, oauth2-proxy) has already verified the user and set
 * identity headers; this door finds-or-creates the user + membership and
 * mints/reuses the session, stamping the header-borne role and teams onto
 * the SESSION row (`trustedRole`/`trustedTeams` — the proxy is the source
 * of truth; the member row keeps a placeholder role, and the org middleware
 * applies the override at read time, the 0.4 JWT-claim semantic).
 */

export interface TrustedHeadersAuthResult {
  userId: string;
  organizationId: string | null;
  sessionToken: string;
  shouldClearOldSession: boolean;
  trustedHeadersChanged: boolean;
}

export async function trustedHeadersAuthenticate(
  sql: Sql,
  args: {
    email: string;
    name: string;
    role: string;
    teams: { id: string; name: string }[] | null;
    existingSessionToken?: string;
    ipAddress?: string;
    userAgent?: string;
    secret?: string;
  },
): Promise<TrustedHeadersAuthResult> {
  const requiredSecret = process.env.TRUSTED_HEADERS_INTERNAL_SECRET;
  if (requiredSecret && args.secret !== requiredSecret) {
    throw new Error(
      'Invalid internal secret for trusted headers authentication',
    );
  }
  const email = args.email.toLowerCase().trim();
  const name = args.name.trim();
  const trustedTeams =
    args.teams !== null
      ? JSON.stringify(resolveTeams({ teams: args.teams }).teams)
      : undefined;

  return sql.begin(async (tx) => {
    const now = new Date();

    // ---- find-or-create the user + org linkage -------------------------
    const users = await tx<{ id: string; name: string }[]>`
      SELECT "id", "name" FROM "user" WHERE "email" = ${email} LIMIT 1
    `;
    let userId: string;
    let organizationId: string | null = null;
    if (users[0] !== undefined) {
      userId = users[0].id;
      if (users[0].name !== name) {
        await tx`
          UPDATE "user" SET "name" = ${name}, "updatedAt" = ${now}
          WHERE "id" = ${userId}
        `;
      }
      const members = await tx<{ organizationId: string }[]>`
        SELECT "organizationId" FROM "member"
        WHERE "userId" = ${userId} LIMIT 1
      `;
      organizationId = members[0]?.organizationId ?? null;
    } else {
      const created = await tx<{ id: string }[]>`
        INSERT INTO "user" (
          "id", "email", "name", "emailVerified", "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid(), ${email}, ${name}, true, ${now}, ${now}
        )
        RETURNING "id"
      `;
      const createdId = created[0]?.id;
      if (createdId === undefined) throw new Error('user insert failed');
      userId = createdId;

      // Attach to the existing org (the one with an admin) so trusted-
      // headers users land together; the very first user gets a default org
      // and the admin seat. The member ROLE is a placeholder — the real
      // role rides the session.
      const admins = await tx<{ organizationId: string }[]>`
        SELECT "organizationId" FROM "member"
        WHERE lower("role") = 'admin'
        ORDER BY "createdAt" ASC LIMIT 1
      `;
      if (admins[0] !== undefined) {
        organizationId = admins[0].organizationId;
        await tx`
          INSERT INTO "member" (
            "id", "organizationId", "userId", "role", "createdAt"
          ) VALUES (
            gen_random_uuid(), ${organizationId}, ${userId}, 'member', ${now}
          )
        `;
        await joinedAudit(tx, organizationId, userId, email, 'member');
      } else {
        const orgs = await tx<{ id: string }[]>`
          INSERT INTO "organization" ("id", "name", "slug", "createdAt")
          VALUES (
            gen_random_uuid(), ${`${name}'s Organization`},
            ${`${email.split('@')[0]}-org-${Date.now()}`}, ${now}
          )
          RETURNING "id"
        `;
        const orgId = orgs[0]?.id;
        if (orgId === undefined) throw new Error('organization insert failed');
        organizationId = orgId;
        await tx`
          INSERT INTO "member" (
            "id", "organizationId", "userId", "role", "createdAt"
          ) VALUES (
            gen_random_uuid(), ${organizationId}, ${userId}, 'admin', ${now}
          )
        `;
        await joinedAudit(tx, organizationId, userId, email, 'admin');
      }
    }

    // ---- create or reuse the session ------------------------------------
    const nowMs = now.getTime();
    const expiresAt = new Date(sessionExpiryMs(nowMs, 24 * 60 * 60 * 1000));
    let shouldClearOldSession = false;

    if (args.existingSessionToken !== undefined) {
      const existing = await tx<
        {
          id: string;
          userId: string;
          token: string;
          expiresAt: Date;
          trustedRole: string | null;
          trustedTeams: string | null;
        }[]
      >`
        SELECT "id", "userId", "token", "expiresAt", "trustedRole",
               "trustedTeams"
        FROM "session" WHERE "token" = ${args.existingSessionToken} LIMIT 1
      `;
      const row = existing[0];
      if (row !== undefined) {
        if (row.userId !== userId) {
          // Account switch behind the proxy: the other user's session dies.
          await tx`DELETE FROM "session" WHERE "id" = ${row.id}`;
          shouldClearOldSession = true;
        } else if (row.expiresAt.getTime() > nowMs) {
          const trustedHeadersChanged =
            (row.trustedRole ?? null) !== (args.role ?? null) ||
            (row.trustedTeams ?? null) !== (trustedTeams ?? null);
          await tx`
            UPDATE "session" SET
              "expiresAt" = ${expiresAt}, "updatedAt" = ${now},
              "trustedRole" = ${args.role ?? null},
              "trustedTeams" = ${trustedTeams ?? null}
            WHERE "id" = ${row.id}
          `;
          return {
            userId,
            organizationId,
            sessionToken: row.token,
            shouldClearOldSession: false,
            trustedHeadersChanged,
          };
        }
      }
    }

    const reusable = await tx<
      {
        id: string;
        token: string;
        expiresAt: Date;
        trustedRole: string | null;
        trustedTeams: string | null;
      }[]
    >`
      SELECT "id", "token", "expiresAt", "trustedRole", "trustedTeams"
      FROM "session" WHERE "userId" = ${userId} LIMIT 1
    `;
    const candidate = reusable[0];
    if (candidate !== undefined && candidate.expiresAt.getTime() > nowMs) {
      const trustedHeadersChanged =
        (candidate.trustedRole ?? null) !== (args.role ?? null) ||
        (candidate.trustedTeams ?? null) !== (trustedTeams ?? null);
      await tx`
        UPDATE "session" SET
          "expiresAt" = ${expiresAt}, "updatedAt" = ${now},
          "trustedRole" = ${args.role ?? null},
          "trustedTeams" = ${trustedTeams ?? null}
        WHERE "id" = ${candidate.id}
      `;
      return {
        userId,
        organizationId,
        sessionToken: candidate.token,
        shouldClearOldSession: args.existingSessionToken !== undefined,
        trustedHeadersChanged,
      };
    }

    const sessionToken = globalThis.crypto.randomUUID();
    await tx`
      INSERT INTO "session" (
        "id", "token", "userId", "expiresAt", "createdAt", "updatedAt",
        "ipAddress", "userAgent", "trustedRole", "trustedTeams",
        "activeOrganizationId"
      ) VALUES (
        gen_random_uuid(), ${sessionToken}, ${userId}, ${expiresAt}, ${now},
        ${now}, ${args.ipAddress ?? null}, ${args.userAgent ?? null},
        ${args.role ?? null}, ${trustedTeams ?? null},
        ${organizationId}
      )
    `;
    return {
      userId,
      organizationId,
      sessionToken,
      shouldClearOldSession,
      trustedHeadersChanged: true,
    };
  });
}

async function joinedAudit(
  tx: Parameters<typeof createAuditLog>[0],
  organizationId: string,
  userId: string,
  email: string,
  role: string,
): Promise<void> {
  try {
    await createAuditLog(tx, {
      organizationId,
      actorId: userId,
      actorEmail: email,
      actorType: 'user',
      action: 'joined_organization',
      category: 'member',
      resourceType: 'member',
      resourceId: userId,
      newState: { role },
      status: 'success',
    });
  } catch (error) {
    console.error(
      '[trusted_headers] failed to write joined_organization audit',
      error instanceof Error ? error.message : error,
    );
  }
}

// ---------------------------------------------------------------- route

const SESSION_COOKIE_NAME = 'better-auth.session_token';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function headerName(envVar: string, fallback: string): string {
  return process.env[envVar] || fallback;
}

function extractCookieValue(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return decodeURIComponent(trimmed.slice(name.length + 1));
    }
  }
  return undefined;
}

function escapeHtmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function errorPage(basePath: string, message: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Login Error</title></head>
<body>
  <p>Error: ${escapeHtmlAttr(message)}</p>
  <p><a href="${basePath}/log-in">Return to login</a></p>
</body>
</html>`;
}

/** GET /api/trusted-headers/authenticate — the proxy hand-off door. */
export function createTrustedHeadersRoutes(deps: { sql: Sql }): Hono {
  const app = new Hono();

  app.get('/authenticate', async (c) => {
    const url = new URL(c.req.url);
    const frontendOrigin = url.origin;
    const basePath = process.env.BASE_PATH || '';
    const redirectTo = sanitizeInternalRedirect(
      url.searchParams.get('redirect'),
      `${basePath}/dashboard`,
    );

    if (process.env.TRUSTED_HEADERS_ENABLED !== 'true') {
      return c.html(
        errorPage(basePath, 'Trusted headers authentication is not enabled'),
      );
    }

    const emailHeader = headerName('TRUSTED_EMAIL_HEADER', 'Remote-Email');
    const email = c.req.header(emailHeader);
    if (!email) {
      return c.html(
        errorPage(basePath, `Missing required header: ${emailHeader}`),
      );
    }
    const name =
      c.req.header(headerName('TRUSTED_NAME_HEADER', 'Remote-Name')) ||
      email.split('@')[0] ||
      email;
    const role =
      c.req.header(headerName('TRUSTED_ROLE_HEADER', 'Remote-Role')) ||
      'member';
    const teamsRaw = c.req.header(
      headerName('TRUSTED_TEAMS_HEADER', 'Remote-Teams'),
    );
    const teams = teamsRaw !== undefined ? parseTeamsHeader(teamsRaw) : null;

    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) {
      console.error('[Trusted Headers] BETTER_AUTH_SECRET not configured');
      return c.html(errorPage(basePath, 'Server configuration error'));
    }

    const isHttps = frontendOrigin.startsWith('https://');
    const cookieName = isHttps
      ? `__Secure-${SESSION_COOKIE_NAME}`
      : SESSION_COOKIE_NAME;
    const existingSessionToken = extractCookieValue(
      c.req.header('cookie'),
      cookieName,
    );
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      undefined;
    const userAgent = c.req.header('user-agent') || undefined;

    try {
      const result = await trustedHeadersAuthenticate(deps.sql, {
        email,
        name,
        role,
        teams,
        ...(existingSessionToken !== undefined ? { existingSessionToken } : {}),
        ...(ip !== undefined ? { ipAddress: ip } : {}),
        ...(userAgent !== undefined ? { userAgent } : {}),
        ...(process.env.TRUSTED_HEADERS_INTERNAL_SECRET !== undefined
          ? { secret: process.env.TRUSTED_HEADERS_INTERNAL_SECRET }
          : {}),
      });

      const signedToken = await signCookieValue(result.sessionToken, secret);
      const cookieParts = [
        `${cookieName}=${signedToken}`,
        `Max-Age=${SESSION_MAX_AGE}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
      ];
      if (isHttps) cookieParts.push('Secure');

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${escapeHtmlAttr(redirectTo)}">
  <title>Completing login...</title>
</head>
<body>
  <p>Completing login, please wait...</p>
</body>
</html>`;
      c.header('Set-Cookie', cookieParts.join('; '));
      return c.html(html);
    } catch (error) {
      console.error('[Trusted Headers] Error:', error);
      return c.html(errorPage(basePath, 'Failed to complete login'));
    }
  });

  return app;
}
