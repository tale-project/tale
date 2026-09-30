import { createServer, type AddressInfo } from 'node:net';

import type { Sql } from 'postgres';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { failureDetail } from '@/app/lib/backend/adapters';
import { createAuth } from '@/backend/auth/auth';
import {
  LAPSED_TEAM_WRITE_ANSWERS,
  lapsedAnswerOf,
  teamWriteClient,
} from '@/backend/auth/team-lapse.integration';
import { i18n } from '@/lib/i18n/i18n';
import { SESSION_ENDED, SHIPPED_LOCALES } from '@/tests/utils/lapsed-session';

import {
  authClientError,
  isLapsedAuthClientAnswer,
  type AuthClientRefusal,
} from './auth-client-error';
import { onSessionLapsed } from './session-lapse';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

/** Every lapse report while `run` runs. */
function reportsDuring(run: () => void): number {
  const heard = vi.fn();
  const stop = onSessionLapsed(heard);
  try {
    run();
  } finally {
    stop();
  }
  return heard.mock.calls.length;
}

const BASE = 'http://localhost:3000';

/** A port nothing listens on: bound, read, released. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  return port;
}

/**
 * Better Auth's answers to the team dialogs' two writes once the session has
 * ended, as the client the dialogs use resolves them. The app's own
 * configuration (`createAuth`) serves them, for a request that carries no
 * session: its database is a port nothing listens on, so an answer that
 * needed it would be a 500, never the lapse. The `backend:integration` lane
 * (`backend/auth/team-lapse.integration.ts`) asks the same writes with an
 * expired and a signed-out session on real Postgres in CI's Backend
 * integration (all lanes) check. This focused unit suite needs no database,
 * so a Better Auth upgrade that changes either answer fails here too.
 */
async function betterAuthLapseAnswers(): Promise<
  Record<keyof typeof LAPSED_TEAM_WRITE_ANSWERS, AuthClientRefusal | null>
> {
  const auth = createAuth({
    databaseUrl: `postgresql://tale:pw@127.0.0.1:${await closedPort()}/tale_app`,
    secret: 'test-secret-at-least-16-chars',
    baseUrl: BASE,
    // A write refused for want of a session never reaches the app lane.
    sql: null as unknown as Sql,
  });
  const client = teamWriteClient(`${BASE}/api/auth`, (input, init) =>
    auth.handler(new Request(input, init)),
  );
  const fromTheApp = { fetchOptions: { headers: { origin: BASE } } };
  const created = await client.organization.createTeam({
    name: 'Finance',
    organizationId: 'org-1',
    ...fromTheApp,
  });
  const updated = await client.organization.updateTeam({
    teamId: 'team-1',
    data: { name: 'Finance', organizationId: 'org-1' },
    ...fromTheApp,
  });
  return { createTeam: created.error, updateTeam: updated.error };
}

let answers: Awaited<ReturnType<typeof betterAuthLapseAnswers>>;
beforeAll(async () => {
  answers = await betterAuthLapseAnswers();
});

describe("Better Auth's answers once the session has ended", () => {
  // `isLapsedAuthClientAnswer` reads exactly these: `update-team`'s session
  // middleware, and the bare 401 of `create-team`, which reads the session
  // itself. A new shape fails here before a dialog shows Better Auth's words.
  it('are the answers the integration lane pins', () => {
    expect(lapsedAnswerOf(answers.createTeam)).toEqual(
      LAPSED_TEAM_WRITE_ANSWERS.createTeam,
    );
    expect(lapsedAnswerOf(answers.updateTeam)).toEqual(
      LAPSED_TEAM_WRITE_ANSWERS.updateTeam,
    );
  });
});

describe('authClientError', () => {
  describe.each([
    { write: 'create-team', key: 'createTeam' },
    { write: 'update-team', key: 'updateTeam' },
  ] as const)("for Better Auth's $write answer", ({ key }) => {
    it.each(SHIPPED_LOCALES)(
      'says the session ended, and reports it (%s)',
      async (locale) => {
        await i18n.changeLanguage(locale);
        const error = answers[key];
        if (error === null) throw new Error(`${key} was not refused`);
        expect(isLapsedAuthClientAnswer(error)).toBe(true);
        let thrown: Error | undefined;
        expect(
          reportsDuring(() => {
            thrown = authClientError(error);
          }),
        ).toBe(1);
        expect(failureDetail(thrown)).toBe(SESSION_ENDED[locale]);
      },
    );
  });

  it("keeps another refusal's words, and reports nothing", () => {
    for (const error of [
      {
        status: 401,
        code: 'INVALID_EMAIL_OR_PASSWORD',
        message: 'Invalid email or password',
      },
      {
        status: 403,
        code: 'YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_TEAM',
        message: 'You are not allowed to update this team',
      },
    ]) {
      expect(isLapsedAuthClientAnswer(error)).toBe(false);
      let thrown: Error | undefined;
      expect(
        reportsDuring(() => {
          thrown = authClientError(error);
        }),
      ).toBe(0);
      expect(failureDetail(thrown)).toBe(error.message);
    }
  });

  // The dialogs used to fill the gap with English ("Failed to create team")
  // under a localized title.
  it('carries no words for a refusal that has none', () => {
    expect(failureDetail(authClientError({ status: 500 }))).toBeUndefined();
    expect(
      failureDetail(authClientError({ status: 409, code: 'CONFLICT' })),
    ).toBeUndefined();
  });
});
