/**
 * Real HTTP + Postgres proof of what Better Auth answers a team write whose
 * session has ended; mounted by backend/integration-check.ts.
 *
 * The team dialogs create and rename a team through Better Auth's own
 * endpoints, and `app/lib/auth/auth-client-error.ts` reads the answer: a 401
 * whose code is `UNAUTHORIZED`, or that carries no code, is a lapsed session,
 * said as the localized "session ended" sentence and reported to the
 * recovery flow. Any other answer keeps the library's words. Nothing pinned
 * the library's half of that reading: `create-team` checks the session
 * itself and answers a bare 401 with an empty body, while `update-team` sits
 * behind the session middleware's `{"message":"Unauthorized",
 * "code":"UNAUTHORIZED"}`. An upgrade that changed either would put Better
 * Auth's English under the dialogs' localized titles, and nothing would fail.
 *
 * This lane asks the real endpoints, through the Better Auth client the SPA
 * uses, with no session cookie, with the cookie of a session that expired and
 * with the cookie of one that signed out, and holds each answer to
 * {@link LAPSED_TEAM_WRITE_ANSWERS} exactly. `app/lib/auth/auth-client-error.test.ts`
 * holds the app's reading to the same answers, and their no-cookie half to
 * the library in the CI `test` lane, which this lane is not part of.
 */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { createAuthClient } from 'better-auth/client';
import { organizationClient } from 'better-auth/client/plugins';
import type { Sql } from 'postgres';

import {
  ITEST_PASSWORD,
  cookieHeaderFrom,
  signUpUser,
} from '../integration-lane-helpers.ts';

/**
 * Better Auth's answer to a team write whose session has ended, as its
 * client resolves it (`{ data: null, error }`), without the `statusText`: the
 * reason phrase is the transport's (HTTP/2 sends none), and nothing reads it.
 */
export interface LapsedTeamWriteAnswer {
  status: number;
  code?: string;
  message?: string;
}

/** What each team write answers once the session is gone. */
export const LAPSED_TEAM_WRITE_ANSWERS = {
  /** The endpoint reads the session itself: a bare 401, no body. */
  createTeam: { status: 401 },
  /** The session middleware's refusal. */
  updateTeam: { status: 401, code: 'UNAUTHORIZED', message: 'Unauthorized' },
} as const satisfies Record<string, LapsedTeamWriteAnswer>;

/** What stands in for the network: the real server, or the handler itself. */
export type TeamWriteFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * The client the SPA's `authClient` is built on, with the same organization
 * plugin (teams on), so an answer is resolved exactly as the dialogs receive
 * it. Without `fetchImpl` it asks the real server over the network.
 */
export function teamWriteClient(baseURL: string, fetchImpl?: TeamWriteFetch) {
  return createAuthClient({
    baseURL,
    plugins: [organizationClient({ teams: { enabled: true } })],
    ...(fetchImpl !== undefined
      ? { fetchOptions: { customFetchImpl: fetchImpl } }
      : {}),
  });
}

/** A resolved client error as {@link LapsedTeamWriteAnswer} states it. */
export function lapsedAnswerOf(error: unknown): unknown {
  if (error === null || typeof error !== 'object') return error;
  return Object.fromEntries(
    Object.entries(error).filter(([key]) => key !== 'statusText'),
  );
}

const SESSION_COOKIE = 'better-auth.session_token';

/** The session token a signed session cookie carries (`<token>.<signature>`). */
function sessionTokenOf(cookie: string): string {
  const pair = cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${SESSION_COOKIE}=`));
  const signed = decodeURIComponent(
    pair?.slice(SESSION_COOKIE.length + 1) ?? '',
  );
  return signed.slice(0, signed.lastIndexOf('.'));
}

export async function checkLapsedTeamWrites(
  sql: Sql,
  base: string,
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const post = (path: string, body: unknown, cookie?: string) =>
    fetch(`${base}/api/auth${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: base,
        ...(cookie !== undefined ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });

  // A throwaway owner of an organization of its own: the lane ends two of
  // its sessions, and the suite's shared session and organization stay as
  // every other lane expects them.
  const owner = await signUpUser(base, `team-lapse-${suffix}`);
  if (owner.userId === '') {
    record(
      'team lapse: the lane signs up its owner',
      false,
      `sign-up of ${owner.email} refused`,
    );
    return;
  }
  const { userId, email } = owner;
  const orgId = randomUUID();
  await sql`
    INSERT INTO "organization" ("id", "name", "slug", "createdAt")
    VALUES (${orgId}, ${`Team lapse ${suffix}`}, ${`team-lapse-${suffix}`},
            ${new Date()})
  `;
  await sql`
    INSERT INTO "member" ("id", "organizationId", "userId", "role",
                          "createdAt")
    VALUES (${randomUUID()}, ${orgId}, ${userId}, 'owner', ${new Date()})
  `;
  const signIn = async (): Promise<string> =>
    cookieHeaderFrom(
      await post('/sign-in/email', { email, password: ITEST_PASSWORD }),
    );

  const client = teamWriteClient(`${base}/api/auth`);
  const as = (cookie: string | undefined) => ({
    fetchOptions: {
      headers: { origin: base, ...(cookie !== undefined ? { cookie } : {}) },
    },
  });

  // The control: a live session creates and renames, so every refusal
  // below is the session's, not a closed door's.
  const live = owner.cookie;
  const teamName = `Lapse ${suffix}`;
  const created = await client.organization.createTeam({
    name: teamName,
    organizationId: orgId,
    ...as(live),
  });
  const teamId = created.data?.id ?? '';
  const renamed = await client.organization.updateTeam({
    teamId,
    data: { name: `${teamName} renamed`, organizationId: orgId },
    ...as(live),
  });
  record(
    'team lapse: a live session creates and renames a team (the control)',
    created.error === null && teamId !== '' && renamed.error === null,
    `create → ${created.error?.status ?? 'ok'} id=${teamId || '-'}, update → ${renamed.error?.status ?? 'ok'}`,
  );

  // A session past its expiry, and one its own tab signed out: the cookie
  // is still sent, and the session behind it is gone.
  const expired = await signIn();
  const expiredRows = await sql`
    UPDATE "session" SET "expiresAt" = ${new Date(Date.now() - 60_000)}
    WHERE "token" = ${sessionTokenOf(expired)} AND "userId" = ${userId}
    RETURNING "id"
  `;
  const signedOut = await signIn();
  const signOut = await post('/sign-out', {}, signedOut);
  const signedOutRows = await sql`
    SELECT "id" FROM "session" WHERE "token" = ${sessionTokenOf(signedOut)}
  `;
  record(
    'team lapse: the lane ends one session by expiry and one by sign-out',
    expiredRows.length === 1 && signOut.ok && signedOutRows.length === 0,
    `expired rows=${expiredRows.length} (want 1), sign-out → ${signOut.status}, signed-out rows left=${signedOutRows.length} (want 0)`,
  );

  const teamsBefore = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM "team" WHERE "organizationId" = ${orgId}
  `;
  for (const [label, cookie] of [
    ['no session cookie', undefined],
    ['an expired session', expired],
    ['a signed-out session', signedOut],
  ] as const) {
    const create = await client.organization.createTeam({
      name: `${teamName} (${label})`,
      organizationId: orgId,
      ...as(cookie),
    });
    record(
      `team lapse: create-team with ${label} answers a bare 401`,
      create.data === null &&
        isDeepStrictEqual(
          lapsedAnswerOf(create.error),
          LAPSED_TEAM_WRITE_ANSWERS.createTeam,
        ),
      `error=${JSON.stringify(lapsedAnswerOf(create.error))} (want ${JSON.stringify(LAPSED_TEAM_WRITE_ANSWERS.createTeam)})`,
    );
    const update = await client.organization.updateTeam({
      teamId,
      data: { name: `${teamName} (${label})`, organizationId: orgId },
      ...as(cookie),
    });
    record(
      `team lapse: update-team with ${label} answers the session middleware's 401`,
      update.data === null &&
        isDeepStrictEqual(
          lapsedAnswerOf(update.error),
          LAPSED_TEAM_WRITE_ANSWERS.updateTeam,
        ),
      `error=${JSON.stringify(lapsedAnswerOf(update.error))} (want ${JSON.stringify(LAPSED_TEAM_WRITE_ANSWERS.updateTeam)})`,
    );
  }

  // A refused write wrote nothing: no team was added, none renamed.
  const teamsAfter = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM "team" WHERE "organizationId" = ${orgId}
  `;
  const names = await sql<{ name: string }[]>`
    SELECT "name" FROM "team" WHERE "id" = ${teamId}
  `;
  record(
    'team lapse: the refused writes change no team',
    teamsAfter[0]?.count === teamsBefore[0]?.count &&
      names[0]?.name === `${teamName} renamed`,
    `teams ${teamsBefore[0]?.count ?? '?'} → ${teamsAfter[0]?.count ?? '?'}, name=${names[0]?.name ?? '-'}`,
  );
}
