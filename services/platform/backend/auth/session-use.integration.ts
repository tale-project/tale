/** Real-Postgres proof that a session's use reaches the row the idle sweep
 * reads (`session-use.ts`, #5249). With `SESSION_IDLE_TIMEOUT_MINUTES`
 * unset, as the harness runs, a single sign-on row lives 30 days and a
 * "don't remember me" row one, and Better Auth slides neither: under an
 * organization's idle window, the ones in use stay signed in, and one left
 * idle past the window is revoked. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { buildSessionCookie } from '../core/enterprise_sso/login/finish_login.ts';
import { createSsoUserSession } from '../domains/sso/service.ts';
import {
  cookieHeaderFrom,
  ITEST_PASSWORD,
  type RecordCheck,
  signUpOrgOwner,
  withCleanup,
} from '../integration-lane-helpers.ts';
import type { Auth } from './auth.ts';

/** The organization's window, and how long ago the fixture's sessions were
 * last used: well past the window, and past the cookie cache's widening. */
const WINDOW_MINUTES = 15;
const LAST_USE_MINUTES_AGO = 60;
const DAY_MS = 24 * 60 * 60_000;

interface SessionRow {
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export async function checkSessionUseUnderIdleWindow(
  sql: Sql,
  base: string,
  auth: Auth,
  record: RecordCheck,
): Promise<void> {
  const owner = await signUpOrgOwner(base, 'session-use');
  const governanceDir = path.join(
    process.env.TALE_CONFIG_DIR ?? '',
    owner.orgSlug,
    'governance',
  );
  const policyFile = path.join(governanceDir, 'session-idle-timeout.yml');
  const orgConfig = await import('../lib/org-config.ts');
  const { revokeIdleSessions } =
    await import('../domains/governance/session-idle.ts');

  await withCleanup(
    [
      [
        "turns the fixture organization's idle window off",
        async () => {
          await writeFile(policyFile, 'enabled: false\n');
          orgConfig.clearOrgConfigCaches();
        },
      ],
    ],
    async () => {
      await mkdir(governanceDir, { recursive: true });
      await writeFile(
        policyFile,
        ['enabled: true', `idleTimeoutMinutes: ${WINDOW_MINUTES}`].join('\n'),
      );
      orgConfig.clearOrgConfigCaches();

      const used = await createSsoUserSession(sql, {
        userId: owner.userId,
        organizationId: owner.orgId,
      });
      const idle = await createSsoUserSession(sql, {
        userId: owner.userId,
        organizationId: owner.orgId,
      });
      const signIn = await fetch(`${base}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base },
        body: JSON.stringify({
          email: owner.email,
          password: ITEST_PASSWORD,
          rememberMe: false,
        }),
      });
      const signedIn = z
        .object({ token: z.string() })
        .safeParse(await signIn.json());
      if (!signedIn.success) {
        throw new Error(
          `the "don't remember me" sign-in answered ${signIn.status} without a session`,
        );
      }
      const tokens = {
        used: used.sessionToken,
        idle: idle.sessionToken,
        forgetful: signedIn.data.token,
      };
      const cookieOf = async (token: string) =>
        (
          await buildSessionCookie(token, base, auth.options.secret ?? '')
        ).split(';')[0] ?? '';
      const cookies = {
        used: await cookieOf(tokens.used),
        idle: await cookieOf(tokens.idle),
        forgetful: cookieHeaderFrom(signIn),
      };
      const read = async (token: string): Promise<SessionRow | null> =>
        (
          await sql<SessionRow[]>`
            SELECT "createdAt", "updatedAt", "expiresAt" FROM "session"
            WHERE "token" = ${token}
          `
        )[0] ?? null;
      const readAll = async () => ({
        used: await read(tokens.used),
        idle: await read(tokens.idle),
        forgetful: await read(tokens.forgetful),
      });
      const readOrganization = async (cookie: string): Promise<number> =>
        (
          await fetch(
            `${base}/api/app/organizations/${encodeURIComponent(owner.orgId)}`,
            { headers: { cookie } },
          )
        ).status;

      // As if each was last used an hour ago, and Better Auth slid none
      // since: the 30-day rows are weeks from their first slide, and the
      // one-day row never gets one.
      for (const token of Object.values(tokens)) {
        await sql`
          UPDATE "session"
          SET "updatedAt" = now() - make_interval(mins => ${LAST_USE_MINUTES_AGO})
          WHERE "token" = ${token}
        `;
      }
      const before = await readAll();
      const usedStatus = await readOrganization(cookies.used);
      const forgetfulStatus = await readOrganization(cookies.forgetful);
      const after = await readAll();

      const lifetimeDays = (row: SessionRow | null) =>
        row === null
          ? null
          : (row.expiresAt.getTime() - row.createdAt.getTime()) / DAY_MS;
      // Moved from an hour back to the request, and nothing else moved.
      const recorded = (
        was: SessionRow | null,
        is: SessionRow | null,
      ): boolean =>
        was !== null &&
        is !== null &&
        is.updatedAt.getTime() - was.updatedAt.getTime() >
          (LAST_USE_MINUTES_AGO - 5) * 60_000 &&
        is.expiresAt.getTime() === was.expiresAt.getTime();
      const forgetfulDays = lifetimeDays(before.forgetful);
      record(
        'session use: a request records its use on a single sign-on and a "don\'t remember me" session, never their expiry',
        usedStatus === 200 &&
          forgetfulStatus === 200 &&
          recorded(before.used, after.used) &&
          recorded(before.forgetful, after.forgetful) &&
          forgetfulDays !== null &&
          forgetfulDays <= 1 &&
          before.idle !== null &&
          after.idle?.updatedAt.getTime() === before.idle.updatedAt.getTime(),
        `requests used=${usedStatus} forgetful=${forgetfulStatus} (want 200, 200); use recorded used=${recorded(before.used, after.used)} forgetful=${recorded(before.forgetful, after.forgetful)} (want true, expiry unchanged); idle untouched=${after.idle?.updatedAt.getTime() === before.idle?.updatedAt.getTime()}; lifetimes in days sso=${lifetimeDays(before.used)} forgetful=${forgetfulDays} (want ≤ 1)`,
      );

      const swept = await revokeIdleSessions(sql);
      const left = await readAll();
      const usedAfterSweep = await readOrganization(cookies.used);
      const forgetfulAfterSweep = await readOrganization(cookies.forgetful);
      const idleAfterSweep = await readOrganization(cookies.idle);
      record(
        'session use: under an idle window the sessions in use stay signed in, and the idle one is revoked',
        swept.revoked >= 1 &&
          left.used !== null &&
          left.forgetful !== null &&
          left.idle === null &&
          usedAfterSweep === 200 &&
          forgetfulAfterSweep === 200 &&
          idleAfterSweep === 401,
        `revoked=${swept.revoked} (want ≥ 1); rows used=${left.used !== null} forgetful=${left.forgetful !== null} idle=${left.idle !== null} (want true, true, false); requests used=${usedAfterSweep} forgetful=${forgetfulAfterSweep} idle=${idleAfterSweep} (want 200, 200, 401)`,
      );
    },
  );
}
