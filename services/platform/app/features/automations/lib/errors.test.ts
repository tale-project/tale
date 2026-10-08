import { describe, expect, it, vi } from 'vitest';

import { BackendApiError } from '@/app/lib/backend/api-client';
import { i18n } from '@/lib/i18n/i18n';
import { AppError } from '@/lib/shared/errors/app-error';
import {
  SESSION_ENDED,
  SHIPPED_LOCALES,
  lapsedSessionRefusal,
} from '@/tests/utils/lapsed-session';

import {
  automationErrorIssues,
  automationErrorMessage,
  isMissingAutomationRead,
} from './errors';

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

describe('automationErrorMessage words', () => {
  it("reads the server's own sentence first", () => {
    const refusal = new AppError({
      code: 'AUTOMATION_TESTS_FAILING',
      message: 'deploy gate: the automation has failing tests',
    });
    expect(automationErrorMessage(refusal)).toBe(
      'deploy gate: the automation has failing tests',
    );
  });

  it('never shows a structured error by its serialized payload', () => {
    const refusal = new AppError({ code: 'SOMETHING', secret: 'payload' });
    const message = automationErrorMessage(refusal);
    expect(message).not.toContain('payload');
    expect(message).not.toContain('{');
  });

  it('gives a server fault the generic sentence, not its body', () => {
    const fault = new BackendApiError(500, 'stack: at db.query (pool.ts:12)');
    expect(automationErrorMessage(fault)).toBe(
      i18n.t('errors.generic', { ns: 'common' }),
    );
  });
});

describe('automationErrorIssues', () => {
  const issue = {
    level: 'error',
    code: 'REF_UNKNOWN_NODE',
    message: 'nodes.nope does not exist',
    at: { pointer: '/nodes/0/prompt', range: [3, 13] },
    params: { node: 'draft', ref: 'nope', available: ['draft'] },
  };

  it('reads the problems a refused save carries', () => {
    const refusal = new AppError({
      code: 'AUTOMATION_INVALID',
      message: 'automation failed validation — fix errors before saving',
      errors: [issue],
      warnings: [],
    });
    expect(automationErrorIssues(refusal)).toEqual({
      errors: [issue],
      warnings: [],
    });
  });

  it('answers nothing for a refusal without a list', () => {
    expect(
      automationErrorIssues(
        new AppError({ code: 'AUTOMATION_NAME_TAKEN', message: 'taken' }),
      ),
    ).toBeUndefined();
    expect(automationErrorIssues(new Error('boom'))).toBeUndefined();
  });

  it('answers nothing for a list in a shape it does not read', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(
      automationErrorIssues(
        new AppError({
          code: 'AUTOMATION_INVALID',
          message: 'refused',
          errors: [{ level: 'fatal', code: 1 }],
        }),
      ),
    ).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
