/**
 * Real-Postgres proof of the re-authentication door against the app's own
 * auth configuration. A session signed in more than a day ago cannot register
 * a passkey — Better Auth answers `SESSION_NOT_FRESH` — and that is everyone
 * the post-grace enrollment wall catches, since they stayed signed in through
 * the whole grace window. `POST /api/auth/reauthenticate` turns their
 * password into a fresh session: a wrong one counts on the account's lockout
 * counter and audits as a failed attempt, a locked account is refused before
 * the check, and a right one replaces the session, so the old cookie stops
 * working. WebAuthn cannot be driven from a script; the registration options
 * call is the freshness gate the ceremony passes first.
 */
import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  cookieHeaderFrom,
  ITEST_PASSWORD,
} from '../integration-lane-helpers.ts';

export async function checkStaleSessionReauthentication(
  sql: Sql,
  base: string,
  ctx: { orgId: string },
  // A dedicated member: the confirmation replaces the calling session.
  member: { cookie: string; userId: string; email: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { userId } = member;
  const email = member.email.toLowerCase();
  const staleCookie = member.cookie;
  // The IP window is shared with every sign-in an earlier lane made this
  // minute; this lane's three attempts must not inherit their count.
  await sql`DELETE FROM app.rate_limits WHERE name = 'security:login-ip'`;
  await sql`
    UPDATE "session" SET "createdAt" = now() - interval '25 hours'
    WHERE "userId" = ${userId}
  `;

  const registrationOptions = (cookie: string): Promise<Response> =>
    fetch(`${base}/api/auth/passkey/generate-register-options`, {
      headers: { cookie },
    });
  const confirm = (cookie: string, password: string): Promise<Response> =>
    fetch(`${base}/api/auth/reauthenticate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base, cookie },
      body: JSON.stringify({ password }),
    });
  const codeOf = async (response: Response): Promise<string | undefined> =>
    z
      .object({ code: z.string() })
      .loose()
      .safeParse(await response.json().catch(() => null)).data?.code;
  const failureCount = async (): Promise<number | null> =>
    (
      await sql<{ failures: number }[]>`
        SELECT consecutive_failures AS failures FROM app.login_attempts
        WHERE email = ${email}
      `
    )[0]?.failures ?? null;

  const stale = await registrationOptions(staleCookie);
  const staleCode = await codeOf(stale);

  const wrong = await confirm(staleCookie, 'not-the-password');
  const wrongCode = await codeOf(wrong);
  const failuresAfterWrong = await failureCount();

  const confirmed = await confirm(staleCookie, ITEST_PASSWORD);
  const freshCookie = cookieHeaderFrom(confirmed);
  const sessions = await sql<{ ageSeconds: number }[]>`
    SELECT extract(epoch FROM now() - "createdAt")::float8 AS "ageSeconds"
    FROM "session" WHERE "userId" = ${userId}
  `;
  const failuresAfterRight = await failureCount();
  const fresh = await registrationOptions(freshCookie);
  const oldCookie = await fetch(`${base}/api/app/two-factor/status`, {
    headers: { cookie: staleCookie },
  });
  const trail = (
    await sql<{ action: string; passwordCheck: string | null }[]>`
      SELECT action, metadata->>'passwordCheck' AS "passwordCheck"
      FROM app.audit_logs
      WHERE org_id = ${ctx.orgId} AND resource_id = ${userId}
        AND action IN ('login_attempt', 'login_success')
      ORDER BY ts ASC
    `
  ).map((row) =>
    row.passwordCheck === null
      ? row.action
      : `${row.action}+${row.passwordCheck}`,
  );

  // A locked account is refused before its password is checked.
  const now = Date.now();
  await sql`
    INSERT INTO app.login_attempts (
      email, consecutive_failures, last_failure_at, locked_until
    ) VALUES (${email}, 5, ${now}, ${now + 60_000})
    ON CONFLICT (email) DO UPDATE SET
      consecutive_failures = 5, last_failure_at = ${now},
      locked_until = ${now + 60_000}
  `;
  const locked = await confirm(freshCookie, ITEST_PASSWORD);
  await sql`DELETE FROM app.login_attempts WHERE email = ${email}`;

  record(
    'reauthenticate: a stale session confirms its password into a fresh one',
    stale.status === 403 &&
      staleCode === 'SESSION_NOT_FRESH' &&
      wrong.status === 400 &&
      wrongCode === 'INVALID_PASSWORD' &&
      failuresAfterWrong === 1 &&
      confirmed.status === 200 &&
      freshCookie.length > 0 &&
      sessions.length === 1 &&
      (sessions[0]?.ageSeconds ?? Number.POSITIVE_INFINITY) < 60 &&
      failuresAfterRight === null &&
      fresh.status === 200 &&
      oldCookie.status === 401 &&
      trail.join(',') ===
        'login_attempt+reauthenticate,login_success+reauthenticate' &&
      locked.status === 429,
    `stale=${stale.status}/${staleCode} (want 403/SESSION_NOT_FRESH), wrong=${wrong.status}/${wrongCode} failures=${failuresAfterWrong}, confirmed=${confirmed.status} sessions=${sessions.length} age=${sessions[0]?.ageSeconds}s counter=${failuresAfterRight}, fresh=${fresh.status} (want 200), oldCookie=${oldCookie.status} (want 401), trail=${trail.join(',')}, locked=${locked.status} (want 429)`,
  );
}
