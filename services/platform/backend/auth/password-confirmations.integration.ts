/**
 * Real-Postgres proof that a signed-in person's password confirmations count
 * like sign-ins (`password-confirmations.ts`). Turning two-factor on or off,
 * new backup codes and a new password each check the password, and anyone
 * holding the session cookie reaches them — so a wrong password bumps the
 * account's sign-in failure counter and audits a stamped `login_attempt`, a
 * right one clears the counter without a `login_success` (the change audits
 * itself), and a locked account is refused before the check: at Better Auth's
 * own doors with 429, and at the app's password door — which reaches
 * `/change-password` through `auth.api` — with `PASSWORD_ATTEMPTS_LOCKED` and
 * the wait.
 */
import type { Sql } from 'postgres';
import { z } from 'zod';

import { ITEST_PASSWORD } from '../integration-lane-helpers.ts';

/** A new password every default policy accepts; never applied here. */
const NEXT_PASSWORD = 'Itest-Next-Passw0rd!42';

export async function checkPasswordConfirmationThrottle(
  sql: Sql,
  base: string,
  ctx: { orgId: string },
  // A dedicated member: these doors change the caller's own account.
  member: { cookie: string; userId: string; email: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { cookie, userId } = member;
  const email = member.email.toLowerCase();
  // The IP window is shared with every sign-in an earlier lane made this
  // minute; this lane's attempts must not inherit their count.
  await sql`DELETE FROM app.rate_limits WHERE name = 'security:login-ip'`;

  const post = (path: string, body: unknown): Promise<Response> =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base, cookie },
      body: JSON.stringify(body),
    });
  const codeOf = async (response: Response): Promise<string | undefined> => {
    const parsed = z
      .object({ code: z.string().optional(), error: z.string().optional() })
      .loose()
      .safeParse(await response.json().catch(() => null));
    return parsed.data?.code ?? parsed.data?.error;
  };
  const failureCount = async (): Promise<number | null> =>
    (
      await sql<{ failures: number }[]>`
        SELECT consecutive_failures AS failures FROM app.login_attempts
        WHERE email = ${email}
      `
    )[0]?.failures ?? null;

  const wrongDisable = await post('/api/auth/two-factor/disable', {
    password: 'not-the-password',
  });
  const wrongDisableCode = await codeOf(wrongDisable);
  const afterDisable = await failureCount();

  const wrongChange = await post('/api/app/users/update-password', {
    currentPassword: 'not-the-password',
    newPassword: NEXT_PASSWORD,
  });
  const wrongChangeCode = await codeOf(wrongChange);
  const afterChange = await failureCount();

  const rightEnable = await post('/api/auth/two-factor/enable', {
    password: ITEST_PASSWORD,
  });
  const afterRight = await failureCount();

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

  // A locked account is refused before its password is checked, the right
  // one included.
  const now = Date.now();
  await sql`
    INSERT INTO app.login_attempts (
      email, consecutive_failures, last_failure_at, locked_until
    ) VALUES (${email}, 5, ${now}, ${now + 60_000})
    ON CONFLICT (email) DO UPDATE SET
      consecutive_failures = 5, last_failure_at = ${now},
      locked_until = ${now + 60_000}
  `;
  const lockedCodes = await post('/api/auth/two-factor/generate-backup-codes', {
    password: ITEST_PASSWORD,
  });
  const lockedChange = await post('/api/app/users/update-password', {
    currentPassword: ITEST_PASSWORD,
    newPassword: NEXT_PASSWORD,
  });
  const lockedChangeBody = z
    .object({
      error: z.literal('PASSWORD_ATTEMPTS_LOCKED'),
      data: z.object({ retryAfter: z.number().positive() }),
    })
    .safeParse(await lockedChange.json().catch(() => null));
  await sql`DELETE FROM app.login_attempts WHERE email = ${email}`;

  record(
    'password confirmations: wrong ones count toward the sign-in lock, which refuses them',
    wrongDisable.status === 400 &&
      wrongDisableCode === 'INVALID_PASSWORD' &&
      afterDisable === 1 &&
      wrongChange.status === 400 &&
      wrongChangeCode === 'INVALID_CURRENT_PASSWORD' &&
      afterChange === 2 &&
      rightEnable.status === 200 &&
      afterRight === null &&
      trail.join(',') ===
        'login_attempt+two_factor_disable,login_attempt+change_password' &&
      lockedCodes.status === 429 &&
      lockedChange.status === 429 &&
      lockedChange.headers.get('retry-after') !== null &&
      lockedChangeBody.success,
    `disable=${wrongDisable.status}/${wrongDisableCode} failures=${afterDisable}, change=${wrongChange.status}/${wrongChangeCode} failures=${afterChange}, enable=${rightEnable.status} failures=${afterRight}, trail=${trail.join(',')}, locked: backup-codes=${lockedCodes.status} change=${lockedChange.status} retry-after=${lockedChange.headers.get('retry-after')} body=${lockedChangeBody.success}`,
  );
}
