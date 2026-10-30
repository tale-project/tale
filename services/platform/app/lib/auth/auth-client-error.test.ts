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
import {
  ACCOUNT_AUTHENTICATION_MESSAGE,
  SESSION_ORGANIZATION_MESSAGE,
} from '@/lib/shared/constants/session-authority';
import { SESSION_ENDED, SHIPPED_LOCALES } from '@/tests/utils/lapsed-session';

import {
  authClientError,
  authSessionRefusal,
  authSessionRefusalMessage,
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
 * expired and a signed-out session on real Postgres; this half runs on
 * every change, with no database, so a Better Auth upgrade that changes
 * either answer fails here.
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

describe('authSessionRefusal', () => {
  // The backend's fetch seam keeps this name on its error, so a screen can
  // tell the refusal apart after the message is localized.
  it('names each authority refusal by its own sentence', () => {
    expect(
      authSessionRefusal({
        status: 403,
        code: 'ORG_FORBIDDEN',
        message: SESSION_ORGANIZATION_MESSAGE,
      }),
    ).toBe('organization');
    expect(
      authSessionRefusal({
        status: 403,
        code: 'SESSION_NOT_FRESH',
        message: ACCOUNT_AUTHENTICATION_MESSAGE,
      }),
    ).toBe('account');
  });
});

describe('authClientError', () => {
  it('does not relabel another meaning of the code or an unauthenticated answer', async () => {
    await i18n.changeLanguage('de');
    for (const error of [
      {
        status: 403,
        code: 'ORG_FORBIDDEN',
        message: 'A different resource belongs to another organization',
      },
      {
        status: 403,
        code: 'SESSION_NOT_FRESH',
        message: 'Session is not fresh',
      },
      {
        status: 401,
        code: 'ORG_FORBIDDEN',
        message:
          'This session is limited to the organization that signed you in.',
      },
    ]) {
      expect(authSessionRefusal(error)).toBeUndefined();
      expect(authSessionRefusalMessage(error)).toBeUndefined();
      expect(authClientError(error).message).toBe(error.message);
    }
  });
  it.each([
    [
      'de',
      'ORG_FORBIDDEN',
      'This session is limited to the organization that signed you in.',
      'Diese Sitzung ist auf die Organisation beschränkt, die dich angemeldet hat.',
    ],
    [
      'fr',
      'ORG_FORBIDDEN',
      'This session is limited to the organization that signed you in.',
      'Cette session est limitée à l’organisation qui t’a connecté.',
    ],
    [
      'de',
      'SESSION_NOT_FRESH',
      'Confirm your password or an account passkey before changing your account.',
      'Bestätige dein Passwort oder einen Passkey für dein Konto, bevor du dein Konto änderst.',
    ],
    [
      'fr',
      'SESSION_NOT_FRESH',
      'Confirm your password or an account passkey before changing your account.',
      'Confirme ton mot de passe ou un passkey de ton compte avant de modifier ton compte.',
    ],
  ])(
    'localizes the actual new authority refusal in %s (%s)',
    async (locale, code, message, expected) => {
      await i18n.changeLanguage(locale);
      expect(authClientError({ status: 403, code, message }).message).toBe(
        expected,
      );
    },
  );
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
