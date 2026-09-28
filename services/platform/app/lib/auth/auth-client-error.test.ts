import { afterEach, describe, expect, it, vi } from 'vitest';

import { failureDetail } from '@/app/lib/backend/adapters';
import { i18n } from '@/lib/i18n/i18n';
import { SESSION_ENDED, SHIPPED_LOCALES } from '@/tests/utils/lapsed-session';

import { authClientError, isLapsedAuthClientAnswer } from './auth-client-error';
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

describe('authClientError', () => {
  // Better Auth's own answers once the session has ended: its session
  // middleware (`update-team`) and the bare 401 of an endpoint that reads the
  // session itself (`create-team`).
  describe.each([
    {
      answer: 'the session middleware',
      error: { status: 401, code: 'UNAUTHORIZED', message: 'Unauthorized' },
    },
    { answer: 'a bare 401', error: { status: 401 } },
  ])('for $answer', ({ error }) => {
    it.each(SHIPPED_LOCALES)(
      'says the session ended, and reports it (%s)',
      async (locale) => {
        await i18n.changeLanguage(locale);
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
