import { describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import {
  SESSION_ENDED,
  SHIPPED_LOCALES,
  lapsedSessionRefusal,
} from '@/tests/utils/lapsed-session';

import { automationErrorMessage, isMissingAutomationRead } from './errors';

describe('isMissingAutomationRead', () => {
  it("treats the store's null as missing", () => {
    expect(
      isMissingAutomationRead({ data: null, isError: false, error: null }),
    ).toBe(true);
  });

  it("treats the backend's structured 404 refusal as missing", () => {
    expect(
      isMissingAutomationRead({
        data: undefined,
        isError: true,
        error: {
          data: {
            code: 'automation not found',
            message: 'automation not found',
          },
        },
      }),
    ).toBe(true);
  });

  it('keeps a transport or server failure as an error, not a missing row', () => {
    expect(
      isMissingAutomationRead({
        data: undefined,
        isError: true,
        error: new Error('Request failed with status 502'),
      }),
    ).toBe(false);
  });

  it('is not missing while the read is still pending or has answered', () => {
    expect(
      isMissingAutomationRead({ data: undefined, isError: false, error: null }),
    ).toBe(false);
    expect(
      isMissingAutomationRead({
        data: { name: 'x' },
        isError: false,
        error: null,
      }),
    ).toBe(false);
  });
});

// The builder shows the store's own sentence verbatim; a lapsed session's
// sentence is the app's, in the author's language — never the session door's
// guidance for API clients.
describe('automationErrorMessage', () => {
  it.each(SHIPPED_LOCALES)(
    "reads a lapsed session's refusal as the session-ended sentence (%s)",
    async (locale) => {
      await i18n.changeLanguage(locale);
      const refusal: unknown = await lapsedSessionRefusal().catch(
        (error: unknown) => error,
      );
      expect(automationErrorMessage(refusal)).toBe(SESSION_ENDED[locale]);
      await i18n.changeLanguage('en');
    },
  );
});
