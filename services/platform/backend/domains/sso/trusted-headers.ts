import { frameAncestorsOf } from '@tale/shared/schemas/governance';
import { sessionExpiryMs } from '@tale/shared/utils/session-idle';
import { Hono, type MiddlewareHandler } from 'hono';
import type { Sql } from 'postgres';

import { PROXY_HANDOFF_HOLD_COOKIE } from '../../../lib/shared/constants/trusted-headers.ts';
import {
  clampAssertedRole,
  type TrustedHeaderAssertableRole,
} from '../../../lib/shared/schemas/trusted_headers.ts';
import { sanitizeInternalRedirect } from '../../../lib/shared/utils/safe-redirect.ts';
import { rememberMintedCookie } from '../../auth/minted-cookie.ts';
import type { AuthEnv } from '../../auth/session.ts';
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
      // The proxy is the role authority for this organization: the seat
      // follows the (clamped) assertion on every sign-in, so Settings >
      // Members shows what the session enforces. The owner seat is never
      // moved — the proxy cannot assert owner and must not demote one.
      const seatRole = members[0].role.toLowerCase();
      if (seatRole !== 'owner' && seatRole !== args.role) {
        await tx`
          UPDATE "member" SET "role" = ${args.role}
          WHERE "userId" = ${userId} AND "organizationId" = ${args.organizationId}
        `;
        await roleMovedAudit(tx, {
          organizationId: args.organizationId,
          userId,
          email,
          previousRole: seatRole,
          role: args.role,
        });
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
      // The member row carries the clamped role the proxy asserted; a later
      // sign-in that asserts another role moves the seat (above), and the
      // session override keeps authorization on the asserted role either way.
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

/** The seat moved to the role the proxy asserted — the same row a manual
 * role change writes, so the Members audit reads as one history. */
async function roleMovedAudit(
  tx: Parameters<typeof createAuditLog>[0],
  args: {
    organizationId: string;
    userId: string;
    email: string;
    previousRole: string;
    role: string;
  },
): Promise<void> {
  try {
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.userId,
      actorEmail: args.email,
      actorType: 'user',
      action: 'update_member_role',
      category: 'member',
      resourceType: 'member',
      resourceId: args.userId,
      resourceName: args.email,
      previousState: { role: args.previousRole },
      newState: { role: args.role, via: 'trusted_headers' },
      status: 'success',
    });
  } catch (error) {
    console.error(
      '[trusted_headers] failed to write update_member_role audit',
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

/**
 * A refusal answered as a page — for a proxy that routes /log-in to this
 * door, or a terminal. Kept to the app's plain typography (system font, one
 * column, colour-scheme aware) so it reads as Tale's rather than a raw error
 * dump, with the way back to the sign-in page.
 */
function refusalPage(basePath: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign-in</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: Canvas; color: CanvasText; }
  main { max-width: 28rem; padding: 2rem 1.5rem; }
  h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
  p { margin: 0 0 1.25rem; }
</style>
</head>
<body>
<main>
  <h1>Sign-in could not be completed</h1>
  <p>${escapeHtmlAttr(message)}</p>
  <p><a href="${escapeHtmlAttr(`${basePath}/log-in`)}">Back to sign in</a></p>
</main>
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
 * The key the proxy presented in the key header (`Remote-Internal-Secret`
 * unless the operator renamed it with `TRUSTED_SECRET_HEADER`). One header,
 * one way to send it — a bearer variant would only be a second thing to
 * document and to confuse with the REST API key. Empty is absent.
 */
export function presentedTrustedHeaderKey(
  keyHeader: string | undefined,
): string | undefined {
  const candidate = keyHeader?.trim();
  return candidate ? candidate : undefined;
}

/**
 * What the proxy's assertion on one request amounts to: a minted (or
 * refreshed) session with its cookie, or a refusal naming why. The hand-off
 * door and the transparent sign-in on the app's own requests both judge a
 * request through this one function, so a request is admitted or refused
 * identically whichever way it arrives.
 */
type HandOffRefusalKind =
  | 'missing_key'
  | 'unknown_key'
  | 'rate_limited'
  | 'disabled'
  | 'missing_email'
  | 'not_member'
  | 'config_error'
  | 'failed';

type HandOffOutcome =
  | {
      ok: true;
      organizationId: string;
      /** The whole Set-Cookie value the browser is handed. */
      setCookie: string;
      /** `name=value` — what a Cookie header carries on the next request. */
      cookiePair: string;
      result: TrustedHeadersAuthResult;
    }
  | {
      ok: false;
      kind: HandOffRefusalKind;
      /** Known once the key has named an organization; null before that. */
      organizationId: string | null;
    };

const REFUSAL_STATUS: Record<HandOffRefusalKind, 400 | 401 | 403 | 429 | 500> =
  {
    missing_key: 401,
    unknown_key: 401,
    rate_limited: 429,
    disabled: 403,
    missing_email: 400,
    not_member: 403,
    config_error: 500,
    failed: 500,
  };

/** The app's translation key for each refusal (`auth` namespace). */
const REFUSAL_MESSAGE_KEY: Record<HandOffRefusalKind, string> = {
  missing_key: 'login.proxyHandoff.errors.missingKey',
  unknown_key: 'login.proxyHandoff.errors.unknownKey',
  rate_limited: 'login.proxyHandoff.errors.rateLimited',
  disabled: 'login.proxyHandoff.errors.disabled',
  missing_email: 'login.proxyHandoff.errors.missingEmail',
  not_member: 'login.proxyHandoff.errors.notMember',
  config_error: 'login.proxyHandoff.errors.configError',
  failed: 'login.proxyHandoff.errors.failed',
};

function refusalMessage(
  kind: HandOffRefusalKind,
  names: ReturnType<typeof trustedHeaderNames>,
): string {
  const messages: Record<HandOffRefusalKind, string> = {
    missing_key: `Missing trusted-header key: send it in the "${names.key}" header`,
    unknown_key: 'Invalid or revoked trusted-header key',
    rate_limited: 'Too many failed attempts; try again later',
    disabled: 'Trusted headers are disabled for this organization',
    missing_email: `Missing required header: ${names.email}`,
    not_member:
      'This account is not a member of the organization this key belongs to. Ask an administrator to add you, then try again.',
    config_error: 'Server configuration error',
    failed: 'Failed to complete login',
  };
  return messages[kind];
}

/**
 * Judge one request's proxy assertion end to end: the key names the
 * organization (and is charged to the source IP when it names nothing), the
 * switch and the identity header are checked, the role is clamped, the
 * teams parsed, and the session minted or refreshed — with the cookie the
 * browser gets. Says nothing about the response: the callers decide how to
 * answer.
 */
export async function handOffFromHeaders(
  sql: Sql,
  req: Request,
): Promise<HandOffOutcome> {
  const names = trustedHeaderNames();
  const header = (name: string): string | undefined =>
    req.headers.get(name) ?? undefined;
  const ip =
    header('x-forwarded-for')?.split(',')[0]?.trim() ||
    header('x-real-ip') ||
    undefined;

  // The key is what separates "came through the organization's proxy"
  // from "reached the endpoint directly" — the identity headers alone are
  // forgeable by anyone who can speak to the backend.
  const presented = presentedTrustedHeaderKey(header(names.key));
  if (presented === undefined) {
    return { ok: false, kind: 'missing_key', organizationId: null };
  }
  const resolved = await resolveTrustedHeaderKey(sql, presented);
  if (resolved === null) {
    // A key that resolves to nothing is charged to its source IP before
    // it learns anything — the REST door's pre-auth posture.
    try {
      await checkIpRateLimit(
        sql,
        'trusted-headers:auth-fail-ip',
        ip ?? 'unknown',
      );
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        return { ok: false, kind: 'rate_limited', organizationId: null };
      }
      throw error;
    }
    return { ok: false, kind: 'unknown_key', organizationId: null };
  }
  const organizationId = resolved.organizationId;
  if (!resolved.enabled) {
    return { ok: false, kind: 'disabled', organizationId };
  }

  const email = header(names.email)?.trim();
  if (!email) {
    return { ok: false, kind: 'missing_email', organizationId };
  }
  const name = header(names.name) || email.split('@')[0] || email;
  const role = clampAssertedRole(header(names.role), resolved.maxAssertedRole);
  const teamsRaw = header(names.teams);
  // Absent header: the proxy makes no claim about teams. Present but
  // empty: the proxy asserts NO teams, which revokes what it granted.
  // A present header that parses to nothing revokes too — say so, or a
  // misconfigured proxy strips teams silently.
  const parsedTeams =
    teamsRaw !== undefined ? parseTeamsHeader(teamsRaw) : undefined;
  if (teamsRaw !== undefined && teamsRaw.trim() !== '' && !parsedTeams) {
    console.warn(
      `[Trusted Headers] ${names.teams} carries no team entry; treating it as an empty team assertion`,
    );
  }
  const teams = teamsRaw !== undefined ? (parsedTeams ?? []) : null;

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    console.error('[Trusted Headers] BETTER_AUTH_SECRET not configured');
    return { ok: false, kind: 'config_error', organizationId };
  }
  // Public origin, not the internal request origin — this door lives
  // behind a reverse-proxy chain by definition, and the origin decides the
  // __Secure-/Secure cookie shape Better Auth will read back.
  const frontendOrigin = publicOrigin(req);
  const cookieName = sessionCookieName(frontendOrigin);
  // The cookie carries what signCookieValue minted — `${token}.${signature}`
  // — while the session row stores the bare token, so the lookup needs the
  // verified, stripped value. A cookie that fails verification is treated
  // as no cookie at all.
  const presentedCookie = readCookie(header('cookie'), cookieName);
  const existingSessionToken =
    presentedCookie !== undefined
      ? ((await verifySignedValue(presentedCookie, secret)) ?? undefined)
      : undefined;
  const userAgent = header('user-agent') || undefined;

  try {
    const result = await trustedHeadersAuthenticate(sql, {
      organizationId,
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
      await touchTrustedHeaderKeyLastUsed(sql, resolved.keyId);
    } catch (error) {
      console.warn('[Trusted Headers] last-used stamp failed:', error);
    }
    const setCookie = await buildSessionCookie(
      result.sessionToken,
      frontendOrigin,
      secret,
    );
    return {
      ok: true,
      organizationId,
      setCookie,
      cookiePair: setCookie.split(';')[0]?.trim() ?? setCookie,
      result,
    };
  } catch (error) {
    if (error instanceof TrustedHeadersRefusedError) {
      console.warn(
        `[Trusted Headers] refused: ${error.reason} (organization ${organizationId})`,
      );
      return { ok: false, kind: 'not_member', organizationId };
    }
    console.error('[Trusted Headers] Error:', error);
    return { ok: false, kind: 'failed', organizationId };
  }
}

/**
 * GET /api/trusted-headers/authenticate — the proxy hand-off door. A
 * success answers a 302 to the in-app return path with the session cookie:
 * no page of its own. A refusal goes back to the app's sign-in page with
 * the reason when the app sent the browser here (`via=app`), and is
 * answered as a page with its status code otherwise — a proxy that routes
 * /log-in to this door would only bounce a redirect straight back.
 */
export function createTrustedHeadersRoutes(deps: { sql: Sql }): Hono {
  const app = new Hono();

  app.get('/authenticate', async (c) => {
    const url = new URL(c.req.url);
    const basePath = process.env.BASE_PATH || '';
    const redirectTo = sanitizeInternalRedirect(
      url.searchParams.get('redirect'),
      `${basePath}/dashboard`,
    );
    const fromApp = url.searchParams.get('via') === 'app';

    const outcome = await handOffFromHeaders(deps.sql, c.req.raw);
    // Framing is judged per organization once the key has named one; until
    // then nothing may frame the answer.
    const framing = framingHeaders(
      outcome.organizationId === null
        ? []
        : await resolveFrameAncestors(deps.sql, outcome.organizationId),
    );
    for (const [name, value] of Object.entries(framing)) c.header(name, value);
    c.header('Cache-Control', 'no-store');

    if (outcome.ok) {
      c.header('Set-Cookie', outcome.setCookie);
      return c.redirect(redirectTo, 302);
    }
    if (fromApp) {
      const back = new URLSearchParams({
        error: REFUSAL_MESSAGE_KEY[outcome.kind],
        error_code: `trusted_headers.${outcome.kind}`,
        recovery: 'login.proxyHandoff.recovery',
      });
      return c.redirect(`${basePath}/log-in?${back.toString()}`, 302);
    }
    return c.html(
      refusalPage(basePath, refusalMessage(outcome.kind, trustedHeaderNames())),
      REFUSAL_STATUS[outcome.kind],
    );
  });

  return app;
}

/**
 * Transparent sign-in on the app's own requests. When a request the app
 * makes for itself — a GET: the session probe, a read — carries the proxy's
 * key and identity header but no session cookie, the session is minted
 * right here and the request goes on as signed in: the cookie rides on the
 * response and on the request the downstream gate reads. The browser never
 * sees a sign-in page. Held back by the hold cookie the app sets after an
 * inactivity sign-out (the notice must stay visible, #1502) and by any
 * session cookie already present (a stale one is the sign-in page's case).
 * A refusal is silent here — the request goes on unauthenticated and the
 * sign-in page, whose hand-off names the reason, takes over.
 */
export function trustedHeadersSessionMint(deps: {
  sql: Sql;
}): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    if (c.req.method !== 'GET') return next();
    // A page on another site must not be able to act through the proxy's
    // headers without a cookie of its own: the app's fetches are
    // same-origin, and a typed address carries no Sec-Fetch-Site at all.
    if (c.req.header('sec-fetch-site') === 'cross-site') return next();
    const names = trustedHeaderNames();
    if (presentedTrustedHeaderKey(c.req.header(names.key)) === undefined) {
      return next();
    }
    if (!c.req.header(names.email)?.trim()) return next();
    const cookieHeader = c.req.header('cookie');
    if (readCookie(cookieHeader, PROXY_HANDOFF_HOLD_COOKIE) !== undefined) {
      return next();
    }
    const sessionCookie = sessionCookieName(publicOrigin(c.req.raw));
    if (readCookie(cookieHeader, sessionCookie) !== undefined) return next();

    const outcome = await handOffFromHeaders(deps.sql, c.req.raw);
    if (!outcome.ok) {
      console.warn(
        `[Trusted Headers] transparent sign-in refused: ${outcome.kind}`,
      );
      return next();
    }
    rememberMintedCookie(c.req.raw, outcome.cookiePair);
    c.header('Set-Cookie', outcome.setCookie, { append: true });
    return next();
  };
}
