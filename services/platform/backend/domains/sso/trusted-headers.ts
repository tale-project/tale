import { timingSafeEqual } from 'node:crypto';

import { Hono } from 'hono';
import type { Sql } from 'postgres';

import { sessionExpiryMs } from '../../../lib/shared/session-idle.ts';
import { sanitizeInternalRedirect } from '../../../lib/shared/utils/safe-redirect.ts';
import { ADMIN_ROLES } from '../../auth/membership.ts';
import { readCookie } from '../../core/enterprise_sso/login/cookies.ts';
import {
  buildSessionCookie,
  sessionCookieName,
} from '../../core/enterprise_sso/login/finish_login.ts';
import { publicOrigin } from '../../core/enterprise_sso/login/public_origin.ts';
import { verifySignedValue } from '../../core/enterprise_sso/sign_cookie_value.ts';
import { parseTeamsHeader } from '../../core/trusted_headers_auth/authenticate_handler.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { anchorTwoFactorGraceOnSignIn } from '../two_factor/service.ts';
import { syncTeamsFromGroupNames } from './service.ts';

/**
 * Trusted-headers authentication — the 0.5 twin of
 * `trusted_headers_auth/authenticate_handler.ts` +
 * `betterAuth/trusted_headers/*`: an authenticating reverse proxy
 * (Authelia, Authentik, oauth2-proxy) has already verified the user and set
 * identity headers; this door finds-or-creates the user + membership and
 * mints/reuses the session, stamping the header-borne role onto the SESSION
 * row (`trustedRole` — the proxy is the source of truth; the member row
 * keeps a placeholder role, and the org middleware applies the override at
 * read time, the 0.4 JWT-claim semantic). The header-borne TEAMS become real
 * memberships: they feed the same provenance-scoped group→team sync the SSO
 * sign-in uses, so team-scoped access reads them like any other membership.
 */

export interface TrustedHeadersAuthResult {
  userId: string;
  organizationId: string | null;
  sessionToken: string;
}

function secretsMatch(supplied: string, required: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(required);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function trustedHeadersAuthenticate(
  sql: Sql,
  args: {
    email: string;
    name: string;
    role: string;
    /**
     * The proxy's team assertion — `null` when the teams header is absent
     * (teams stay whatever an admin manages), an array (possibly empty) when
     * it is present. Present means authoritative: the names are mirrored
     * onto org teams through `syncTeamsFromGroupNames`, which grants what
     * the header carries and revokes only what an earlier sync granted.
     */
    teams: { id: string; name: string }[] | null;
    /**
     * The CALLER-SUPPLIED internal secret (the request header the trusted
     * proxy chain injects), compared against
     * `TRUSTED_HEADERS_INTERNAL_SECRET`. It used to be read FROM that env var
     * at the call site, so the guard compared the secret against itself and
     * could never fail — anyone reaching the endpoint minted a session as
     * whoever `Remote-Email` named. Fail closed: no env secret, no door.
     */
    secret: string | undefined;
    /**
     * The BARE session token from the browser's own cookie, after the route
     * verified its signature (the cookie carries `${token}.${signature}`; the
     * row stores the token). Reuse is bound to THIS session and no other:
     * the door never adopts another device's row for the same user — that
     * silently shared one session across devices (sign out on one killed
     * both) — so no cookie, or one that fails verification, mints afresh.
     */
    existingSessionToken?: string;
    ipAddress?: string;
    userAgent?: string;
  },
): Promise<TrustedHeadersAuthResult> {
  const requiredSecret = process.env.TRUSTED_HEADERS_INTERNAL_SECRET;
  if (!requiredSecret) {
    throw new Error(
      'TRUSTED_HEADERS_INTERNAL_SECRET is not configured — trusted-headers ' +
        'authentication refuses to run without it',
    );
  }
  if (args.secret === undefined || !secretsMatch(args.secret, requiredSecret)) {
    throw new Error(
      'Invalid internal secret for trusted headers authentication',
    );
  }
  const email = args.email.toLowerCase().trim();
  const name = args.name.trim();

  const result = await sql.begin<TrustedHeadersAuthResult>(async (tx) => {
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

      // Attach to the existing org (the one with an elevated seat — its
      // creating `owner`, or a granted `admin`) so trusted-headers users land
      // together; the very first user gets a default org and the admin seat.
      // Matching `admin` alone missed every org created through sign-up
      // (Better Auth seats the creator as `owner`) and split the deployment
      // into two tenants on the first proxy login. The member ROLE is a
      // placeholder — the real role rides the session.
      const admins = await tx<{ organizationId: string }[]>`
        SELECT "organizationId" FROM "member"
        WHERE lower("role") = ANY(${[...ADMIN_ROLES]})
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

    // Org 2FA enforcement anchors on this door too — it mints sessions
    // outside the Better Auth sign-in hook, so without this an enforced
    // policy's grace clock never started for proxy-authenticated users.
    await anchorTwoFactorGraceOnSignIn(tx, userId);

    // ---- create or reuse the session ------------------------------------
    const nowMs = now.getTime();
    const expiresAt = new Date(sessionExpiryMs(nowMs, 24 * 60 * 60 * 1000));

    if (args.existingSessionToken !== undefined) {
      const existing = await tx<
        {
          id: string;
          userId: string;
          token: string;
          expiresAt: Date;
          trustedRole: string | null;
        }[]
      >`
        SELECT "id", "userId", "token", "expiresAt", "trustedRole"
        FROM "session" WHERE "token" = ${args.existingSessionToken} LIMIT 1
      `;
      const row = existing[0];
      if (row !== undefined) {
        if (row.userId !== userId) {
          // Account switch behind the proxy: the other user's session dies
          // (the fresh cookie below replaces it in the browser).
          await tx`DELETE FROM "session" WHERE "id" = ${row.id}`;
        } else if (row.expiresAt.getTime() > nowMs) {
          await tx`
            UPDATE "session" SET
              "expiresAt" = ${expiresAt}, "updatedAt" = ${now},
              "trustedRole" = ${args.role ?? null}
            WHERE "id" = ${row.id}
          `;
          return { userId, organizationId, sessionToken: row.token };
        }
      }
    }

    // No (valid, live, same-user) cookie: a fresh session for THIS browser.
    const sessionToken = globalThis.crypto.randomUUID();
    await tx`
      INSERT INTO "session" (
        "id", "token", "userId", "expiresAt", "createdAt", "updatedAt",
        "ipAddress", "userAgent", "trustedRole", "activeOrganizationId"
      ) VALUES (
        gen_random_uuid(), ${sessionToken}, ${userId}, ${expiresAt}, ${now},
        ${now}, ${args.ipAddress ?? null}, ${args.userAgent ?? null},
        ${args.role ?? null}, ${organizationId}
      )
    `;
    return { userId, organizationId, sessionToken };
  });

  // The proxy's team assertion, mirrored onto real team memberships AFTER
  // the session committed — the sync tolerates a failed group by design
  // (a poisoned transaction would not), and a sync problem must not cost
  // the sign-in, exactly as on the SSO door. The 0.4 port stamped the
  // header onto the session row instead, which no 0.5 reader consulted:
  // proxy-asserted teams silently granted nothing.
  if (args.teams !== null && result.organizationId !== null) {
    try {
      const syncResult = await syncTeamsFromGroupNames(sql, {
        userId: result.userId,
        organizationId: result.organizationId,
        groupNames: args.teams.map((team) => team.name),
        excludeGroups: [],
      });
      if (syncResult.errors.length > 0) {
        console.warn('[trusted_headers] team sync errors:', syncResult.errors);
      }
    } catch (error) {
      console.error('[trusted_headers] team sync failed:', error);
    }
  }
  return result;
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

function headerName(envVar: string, fallback: string): string {
  return process.env[envVar] || fallback;
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
    // Public origin, not the internal request origin — this door lives
    // behind a reverse-proxy chain by definition, and the origin decides the
    // __Secure-/Secure cookie shape Better Auth will read back.
    const frontendOrigin = publicOrigin(c.req.url);
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

    // The internal secret is what separates "came through the authenticating
    // proxy" from "reached the endpoint directly" — the identity headers
    // alone are forgeable by anyone who can speak to the backend. Enabled
    // without a secret is a misconfiguration, not a weaker mode.
    if (!process.env.TRUSTED_HEADERS_INTERNAL_SECRET) {
      console.error(
        '[Trusted Headers] TRUSTED_HEADERS_ENABLED is true but ' +
          'TRUSTED_HEADERS_INTERNAL_SECRET is not set. Set the secret and ' +
          'configure the authenticating proxy to send it in the ' +
          `"${headerName('TRUSTED_SECRET_HEADER', 'Remote-Internal-Secret')}" header.`,
      );
      return c.html(errorPage(basePath, 'Server configuration error'));
    }

    const secretHeader = headerName(
      'TRUSTED_SECRET_HEADER',
      'Remote-Internal-Secret',
    );
    const suppliedSecret = c.req.header(secretHeader);
    if (suppliedSecret === undefined) {
      return c.html(
        errorPage(basePath, `Missing required header: ${secretHeader}`),
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
    // Absent header: the proxy makes no claim about teams. Present but
    // empty: the proxy asserts NO teams, which revokes what it granted.
    // A present header that parses to nothing (bare names, no `id:name`)
    // revokes too — say so, or a misconfigured proxy strips teams silently.
    const parsedTeams =
      teamsRaw !== undefined ? parseTeamsHeader(teamsRaw) : undefined;
    if (teamsRaw !== undefined && teamsRaw.trim() !== '' && !parsedTeams) {
      console.warn(
        `[Trusted Headers] ${headerName('TRUSTED_TEAMS_HEADER', 'Remote-Teams')} carries no "id:name" entry; treating it as an empty team assertion`,
      );
    }
    const teams = teamsRaw !== undefined ? (parsedTeams ?? []) : null;

    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) {
      console.error('[Trusted Headers] BETTER_AUTH_SECRET not configured');
      return c.html(errorPage(basePath, 'Server configuration error'));
    }

    const cookieName = sessionCookieName(frontendOrigin);
    // The cookie carries what signCookieValue minted — `${token}.${signature}`
    // — while the session row stores the bare token, so the lookup needs the
    // verified, stripped value. (Matching the signed string against the token
    // column never hit: the reuse and account-switch branches were dead, and
    // every request fell through to adopting an arbitrary row of the user.)
    // A cookie that fails verification is treated as no cookie at all.
    const presentedCookie = readCookie(c.req.header('cookie'), cookieName);
    const existingSessionToken =
      presentedCookie !== undefined
        ? ((await verifySignedValue(presentedCookie, secret)) ?? undefined)
        : undefined;
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
        secret: suppliedSecret,
        ...(existingSessionToken !== undefined ? { existingSessionToken } : {}),
        ...(ip !== undefined ? { ipAddress: ip } : {}),
        ...(userAgent !== undefined ? { userAgent } : {}),
      });

      const cookie = await buildSessionCookie(
        result.sessionToken,
        frontendOrigin,
        secret,
      );

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
      c.header('Set-Cookie', cookie);
      return c.html(html);
    } catch (error) {
      console.error('[Trusted Headers] Error:', error);
      return c.html(errorPage(basePath, 'Failed to complete login'));
    }
  });

  return app;
}
