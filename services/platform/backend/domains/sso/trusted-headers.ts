import { frameAncestorsOf } from '@tale/shared/schemas/governance';
import { sessionExpiryMs } from '@tale/shared/utils/session-idle';
import { Hono } from 'hono';
import type { Sql } from 'postgres';

import {
  clampAssertedRole,
  type TrustedHeaderAssertableRole,
} from '../../../lib/shared/schemas/trusted_headers.ts';
import { sanitizeInternalRedirect } from '../../../lib/shared/utils/safe-redirect.ts';
import { readCookie } from '../../core/enterprise_sso/login/cookies.ts';
import {
  buildSessionCookie,
  sessionCookieName,
} from '../../core/enterprise_sso/login/finish_login.ts';
import { verifySignedValue } from '../../core/enterprise_sso/sign_cookie_value.ts';
import { publicOrigin } from '../../core/lib/helpers/public_origin.ts';
import { parseTeamsHeader } from '../../core/trusted_headers_auth/authenticate_handler.ts';
import { trustedHeaderNames } from '../../core/trusted_headers_auth/header_names.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  resolveTrustedHeaderKey,
  touchTrustedHeaderKeyLastUsed,
} from '../trusted_headers/service.ts';
import { anchorTwoFactorGraceOnSignIn } from '../two_factor/service.ts';
import { syncTeamsFromGroupNames } from './service.ts';

/**
 * Trusted-headers authentication, organization mode — the hand-off door an
 * application's authenticating proxy (Authelia, Authentik, oauth2-proxy, or
 * the host application's own reverse proxy) sends its users through: the
 * proxy has already verified the person, injects identity headers, and
 * presents the ORGANIZATION'S trusted-header key (Settings > Enterprise SSO
 * > Trusted headers). The door resolves the organization from that key —
 * never from a header, a body or a path — finds-or-creates the user inside
 * it, and mints/reuses the session, stamping the asserted role AND the
 * organization onto the SESSION row (`trustedRole` + `trustedOrganizationId`):
 * the proxy is the role authority for that organization only, and the org
 * middleware applies the override at read time for that organization only.
 * The header-borne TEAMS become real memberships through the same
 * provenance-scoped group→team sync the SSO sign-in uses.
 *
 * The org-binding contract of the SSO door holds here too: a key signs in
 * members the organization already has and JIT-creates users NEW to the
 * deployment, but never attaches to an existing user from outside the
 * organization — a proxy asserting a stranger's address would otherwise walk
 * away with that stranger's session.
 */

export interface TrustedHeadersAuthResult {
  userId: string;
  organizationId: string;
  sessionToken: string;
  isNewUser: boolean;
  role: TrustedHeaderAssertableRole;
}

export type TrustedHeadersRefusal = 'existing_user_not_in_org';

/** A sign-in the contract refuses before any write. */
export class TrustedHeadersRefusedError extends Error {
  readonly reason: TrustedHeadersRefusal;

  constructor(reason: TrustedHeadersRefusal) {
    super(`trusted-headers sign-in refused: ${reason}`);
    this.name = 'TrustedHeadersRefusedError';
    this.reason = reason;
  }
}

export async function trustedHeadersAuthenticate(
  sql: Sql,
  args: {
    /** The organization the presented key belongs to. */
    organizationId: string;
    /** The key row that admitted this sign-in — the audit trail's anchor. */
    keyId: string;
    email: string;
    name: string;
    /** The asserted role, ALREADY clamped to the organization's ceiling. */
    role: TrustedHeaderAssertableRole;
    /**
     * The proxy's team assertion — `null` when the teams header is absent
     * (teams stay whatever an admin manages), an array (possibly empty) when
     * it is present. Present means authoritative: the names are mirrored
     * onto org teams through `syncTeamsFromGroupNames`, which grants what
     * the header carries and revokes only what an earlier sync granted.
     */
    teams: { id: string; name: string }[] | null;
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
  const email = args.email.toLowerCase().trim();
  const name = args.name.trim();

  const result = await sql.begin<TrustedHeadersAuthResult>(async (tx) => {
    const now = new Date();

    // ---- find-or-create the user inside the key's organization ----------
    const users = await tx<{ id: string; name: string }[]>`
      SELECT "id", "name" FROM "user" WHERE "email" = ${email} LIMIT 1
    `;
    let userId: string;
    let isNewUser = false;
    if (users[0] !== undefined) {
      userId = users[0].id;
      // The org-binding contract, judged BEFORE any write: an existing user
      // signs in only as a member of this organization. A stranger's
      // address is refused — the proxy holds this organization's key, not
      // a warrant for every account on the deployment.
      const members = await tx<{ role: string }[]>`
        SELECT "role" FROM "member"
        WHERE "userId" = ${userId} AND "organizationId" = ${args.organizationId}
        LIMIT 1
      `;
      if (members[0] === undefined) {
        throw new TrustedHeadersRefusedError('existing_user_not_in_org');
      }
      if (users[0].name !== name) {
        await tx`
          UPDATE "user" SET "name" = ${name}, "updatedAt" = ${now}
          WHERE "id" = ${userId}
        `;
      }
    } else {
      isNewUser = true;
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
      // The member row carries the clamped role the proxy asserted at
      // creation; later sign-ins ride the session override, so the proxy
      // stays the authority without rewriting the row each time.
      await tx`
        INSERT INTO "member" (
          "id", "organizationId", "userId", "role", "createdAt"
        ) VALUES (
          gen_random_uuid(), ${args.organizationId}, ${userId}, ${args.role}, ${now}
        )
      `;
      await joinedAudit(tx, args.organizationId, userId, email, args.role);
    }

    // Org 2FA enforcement anchors on this door too — it mints sessions
    // outside the Better Auth sign-in hook, so without this an enforced
    // policy's grace clock never started for proxy-authenticated users.
    await anchorTwoFactorGraceOnSignIn(tx, userId);

    // ---- create or reuse the session ------------------------------------
    const nowMs = now.getTime();
    const expiresAt = new Date(sessionExpiryMs(nowMs, 24 * 60 * 60 * 1000));
    let sessionToken: string | undefined;

    if (args.existingSessionToken !== undefined) {
      const existing = await tx<
        { id: string; userId: string; token: string; expiresAt: Date }[]
      >`
        SELECT "id", "userId", "token", "expiresAt"
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
              "trustedRole" = ${args.role},
              "trustedOrganizationId" = ${args.organizationId},
              "activeOrganizationId" = ${args.organizationId}
            WHERE "id" = ${row.id}
          `;
          sessionToken = row.token;
        }
      }
    }

    if (sessionToken === undefined) {
      // No (valid, live, same-user) cookie: a fresh session for THIS browser.
      sessionToken = globalThis.crypto.randomUUID();
      await tx`
        INSERT INTO "session" (
          "id", "token", "userId", "expiresAt", "createdAt", "updatedAt",
          "ipAddress", "userAgent", "trustedRole", "trustedOrganizationId",
          "activeOrganizationId"
        ) VALUES (
          gen_random_uuid(), ${sessionToken}, ${userId}, ${expiresAt}, ${now},
          ${now}, ${args.ipAddress ?? null}, ${args.userAgent ?? null},
          ${args.role}, ${args.organizationId}, ${args.organizationId}
        )
      `;
    }

    await signInAudit(tx, {
      organizationId: args.organizationId,
      userId,
      email,
      keyId: args.keyId,
      role: args.role,
      isNewUser,
    });

    return {
      userId,
      organizationId: args.organizationId,
      sessionToken,
      isNewUser,
      role: args.role,
    };
  });

  // The proxy's team assertion, mirrored onto real team memberships AFTER
  // the session committed — the sync tolerates a failed group by design
  // (a poisoned transaction would not), and a sync problem must not cost
  // the sign-in, exactly as on the SSO door.
  if (args.teams !== null) {
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
      newState: { role, via: 'trusted_headers' },
      status: 'success',
    });
  } catch (error) {
    console.error(
      '[trusted_headers] failed to write joined_organization audit',
      error instanceof Error ? error.message : error,
    );
  }
}

/** Every admitted sign-in names the key that admitted it. */
async function signInAudit(
  tx: Parameters<typeof createAuditLog>[0],
  args: {
    organizationId: string;
    userId: string;
    email: string;
    keyId: string;
    role: string;
    isNewUser: boolean;
  },
): Promise<void> {
  try {
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.userId,
      actorEmail: args.email,
      actorType: 'user',
      action: 'trusted_headers_sign_in',
      category: 'auth',
      resourceType: 'trusted_header_key',
      resourceId: args.keyId,
      newState: { role: args.role, newUser: args.isNewUser },
      status: 'success',
    });
  } catch (error) {
    console.error(
      '[trusted_headers] failed to write trusted_headers_sign_in audit',
      error instanceof Error ? error.message : error,
    );
  }
}

// ---------------------------------------------------------------- route

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

/**
 * The framing headers a door response carries. Nothing may frame the door
 * unless the organization's `embedding` policy admits the host page's
 * origin; then `frame-ancestors` names `'self'` plus that list and
 * X-Frame-Options — which cannot express an allowlist — is left off. The
 * backend's fixed DENY is switched off for this door alone
 * (`backendSecureHeaders({frameable: true})` in `app.ts`), so what is set
 * here is what the browser sees.
 */
export function framingHeaders(
  frameAncestors: readonly string[],
): Record<string, string> {
  if (frameAncestors.length === 0) {
    return {
      'Content-Security-Policy': "frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
    };
  }
  return {
    'Content-Security-Policy': `frame-ancestors 'self' ${frameAncestors.join(' ')}`,
  };
}

/** The organization's admitted frame ancestors; a policy read that fails
 * admits nothing — the safe side of a header. */
async function resolveFrameAncestors(
  sql: Sql,
  organizationId: string,
): Promise<string[]> {
  try {
    return frameAncestorsOf(
      await readGovernancePolicyForOrg(sql, organizationId, 'embedding'),
    );
  } catch (error) {
    console.warn(
      '[Trusted Headers] embedding policy unreadable; framing refused:',
      error,
    );
    return [];
  }
}

/**
 * The key the proxy presented: `Authorization: Bearer <key>` first, else
 * the configurable key header (the `Remote-Internal-Secret` slot proxies
 * already inject). Empty is absent.
 */
export function presentedTrustedHeaderKey(
  authorization: string | undefined,
  keyHeader: string | undefined,
): string | undefined {
  const bearer = /^bearer\s+(.+)$/i.exec(authorization ?? '');
  const candidate = bearer?.[1]?.trim() || keyHeader?.trim();
  return candidate ? candidate : undefined;
}

/** GET /api/trusted-headers/authenticate — the proxy hand-off door. */
export function createTrustedHeadersRoutes(deps: { sql: Sql }): Hono {
  const app = new Hono();

  app.get('/authenticate', async (c) => {
    const url = new URL(c.req.url);
    // Public origin, not the internal request origin — this door lives
    // behind a reverse-proxy chain by definition, and the origin decides the
    // __Secure-/Secure cookie shape Better Auth will read back.
    const frontendOrigin = publicOrigin(c.req.raw);
    const basePath = process.env.BASE_PATH || '';
    const redirectTo = sanitizeInternalRedirect(
      url.searchParams.get('redirect'),
      `${basePath}/dashboard`,
    );
    const names = trustedHeaderNames();
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      undefined;
    // Framing is judged per organization once the key names one; until
    // then (no key, unknown key) nothing may frame the answer.
    let framing = framingHeaders([]);
    const page = (
      body: string,
      status: 200 | 400 | 401 | 403 | 429 | 500 = 200,
    ) => {
      for (const [name, value] of Object.entries(framing))
        c.header(name, value);
      return c.html(body, status);
    };

    // The key is what separates "came through the organization's proxy"
    // from "reached the endpoint directly" — the identity headers alone are
    // forgeable by anyone who can speak to the backend.
    const presented = presentedTrustedHeaderKey(
      c.req.header('authorization'),
      c.req.header(names.key),
    );
    if (presented === undefined) {
      return page(
        errorPage(
          basePath,
          `Missing trusted-header key: send it as "Authorization: Bearer <key>" or in the "${names.key}" header`,
        ),
        401,
      );
    }
    const resolved = await resolveTrustedHeaderKey(deps.sql, presented);
    if (resolved === null) {
      // A key that resolves to nothing is charged to its source IP before
      // it learns anything — the REST door's pre-auth posture.
      try {
        await checkIpRateLimit(
          deps.sql,
          'trusted-headers:auth-fail-ip',
          ip ?? 'unknown',
        );
      } catch (error) {
        if (error instanceof RateLimitExceededError) {
          return page(
            errorPage(basePath, 'Too many failed attempts; try again later'),
            429,
          );
        }
        throw error;
      }
      return page(
        errorPage(basePath, 'Invalid or revoked trusted-header key'),
        401,
      );
    }
    framing = framingHeaders(
      await resolveFrameAncestors(deps.sql, resolved.organizationId),
    );
    if (!resolved.enabled) {
      return page(
        errorPage(
          basePath,
          'Trusted headers are disabled for this organization',
        ),
        403,
      );
    }

    const email = c.req.header(names.email);
    if (!email) {
      return page(
        errorPage(basePath, `Missing required header: ${names.email}`),
        400,
      );
    }
    const name = c.req.header(names.name) || email.split('@')[0] || email;
    const role = clampAssertedRole(
      c.req.header(names.role),
      resolved.maxAssertedRole,
    );
    const teamsRaw = c.req.header(names.teams);
    // Absent header: the proxy makes no claim about teams. Present but
    // empty: the proxy asserts NO teams, which revokes what it granted.
    // A present header that parses to nothing (bare names, no `id:name`)
    // revokes too — say so, or a misconfigured proxy strips teams silently.
    const parsedTeams =
      teamsRaw !== undefined ? parseTeamsHeader(teamsRaw) : undefined;
    if (teamsRaw !== undefined && teamsRaw.trim() !== '' && !parsedTeams) {
      console.warn(
        `[Trusted Headers] ${names.teams} carries no "id:name" entry; treating it as an empty team assertion`,
      );
    }
    const teams = teamsRaw !== undefined ? (parsedTeams ?? []) : null;

    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) {
      console.error('[Trusted Headers] BETTER_AUTH_SECRET not configured');
      return page(errorPage(basePath, 'Server configuration error'), 500);
    }

    const cookieName = sessionCookieName(frontendOrigin);
    // The cookie carries what signCookieValue minted — `${token}.${signature}`
    // — while the session row stores the bare token, so the lookup needs the
    // verified, stripped value. A cookie that fails verification is treated
    // as no cookie at all.
    const presentedCookie = readCookie(c.req.header('cookie'), cookieName);
    const existingSessionToken =
      presentedCookie !== undefined
        ? ((await verifySignedValue(presentedCookie, secret)) ?? undefined)
        : undefined;
    const userAgent = c.req.header('user-agent') || undefined;

    try {
      const result = await trustedHeadersAuthenticate(deps.sql, {
        organizationId: resolved.organizationId,
        keyId: resolved.keyId,
        email,
        name,
        role,
        teams,
        ...(existingSessionToken !== undefined ? { existingSessionToken } : {}),
        ...(ip !== undefined ? { ipAddress: ip } : {}),
        ...(userAgent !== undefined ? { userAgent } : {}),
      });
      try {
        await touchTrustedHeaderKeyLastUsed(deps.sql, resolved.keyId);
      } catch (error) {
        console.warn('[Trusted Headers] last-used stamp failed:', error);
      }

      const cookie = await buildSessionCookie(
        result.sessionToken,
        frontendOrigin,
        secret,
      );

      const completing = `<!DOCTYPE html>
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
      return page(completing);
    } catch (error) {
      if (error instanceof TrustedHeadersRefusedError) {
        console.warn(
          `[Trusted Headers] refused: ${error.reason} (organization ${resolved.organizationId})`,
        );
        return page(
          errorPage(
            basePath,
            'This account is not a member of the organization this key belongs to. Ask an administrator to add you, then try again.',
          ),
          403,
        );
      }
      console.error('[Trusted Headers] Error:', error);
      return page(errorPage(basePath, 'Failed to complete login'), 500);
    }
  });

  return app;
}
