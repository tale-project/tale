import { describe, expect, it, vi } from 'vitest';

import { failureDetail } from '@/app/lib/backend/adapters';
import { BackendApiError } from '@/app/lib/backend/api-client';
import { i18n } from '@/lib/i18n/i18n';
import { AppError } from '@/lib/shared/errors/app-error';
import {
  SESSION_ENDED,
  SHIPPED_LOCALES,
  lapsedSessionRefusal,
} from '@/tests/utils/lapsed-session';

import {
  automationDeploymentStale,
  automationErrorFailedTests,
  automationErrorIssues,
  automationErrorMessage,
  automationFailureDetail,
  automationVersionStale,
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

// The builder words a refusal by its code in the author's language; a lapsed
// session's sentence is the app's too — never the session door's guidance
// for API clients.
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
  it('words a refusal by its code, never by the server sentence', () => {
    const refusal = new AppError({
      code: 'AUTOMATION_DEPLOY_REJECTED',
      message:
        'deploy gate: ops/greet@3 was saved with failing tests — fix them and save a new version',
      name: 'ops/greet',
      version: 3,
    });
    expect(automationErrorMessage(refusal)).toBe(
      'v3 of "ops/greet" was saved with failing tests, so it can\'t go live. Fix them and save a new version.',
    );
    expect(automationFailureDetail(refusal)).toBe(
      automationErrorMessage(refusal),
    );
  });

  it("reads the server's sentence for a code this build does not know", () => {
    const refusal = new AppError({
      code: 'AUTOMATION_SOMETHING_NEWER',
      message: 'a newer server refused this',
    });
    expect(automationErrorMessage(refusal)).toBe('a newer server refused this');
  });

  it('leaves a failure that is no refusal to the shared failure words', () => {
    const fault = new BackendApiError(500, 'stack: at db.query (pool.ts:12)');
    expect(automationFailureDetail(fault)).toBe(failureDetail(fault));
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

describe('automationErrorFailedTests', () => {
  const refusal = (report: unknown) =>
    new AppError({
      code: 'AUTOMATION_TESTS_FAILING',
      message: 'deploy gate: the automation has failing tests',
      report,
    });

  it('reads how many tests the gate found failing', () => {
    expect(
      automationErrorFailedTests(
        refusal({ passed: 3, failed: 2, results: [] }),
      ),
    ).toBe(2);
  });

  it('answers nothing for a refusal that names no count', () => {
    expect(automationErrorFailedTests(refusal(undefined))).toBeUndefined();
    expect(automationErrorFailedTests(refusal({ passed: 3 }))).toBeUndefined();
    expect(automationErrorFailedTests(refusal({ failed: 0 }))).toBeUndefined();
    expect(
      automationErrorFailedTests(refusal({ failed: 1.5 })),
    ).toBeUndefined();
    expect(
      automationErrorFailedTests(refusal({ failed: '2' })),
    ).toBeUndefined();
    expect(automationErrorFailedTests(new Error('boom'))).toBeUndefined();
  });
});

describe('a stale deploy or save, in words', () => {
  it('reads who put another version live, when and through what', () => {
    const error = new AppError({
      code: 'AUTOMATION_DEPLOYMENT_STALE',
      message: 'v6 is live now',
      deployedVersion: 6,
      expectedDeployedVersion: 5,
      deployedBy: 'api-key:user-noah',
      deployedAt: 1_791_000_000_000,
      deployedVia: 'mcp',
      deployedClient: 'Claude Code',
    });
    expect(automationDeploymentStale(error)).toEqual({
      version: 6,
      by: 'api-key:user-noah',
      at: 1_791_000_000_000,
      via: 'mcp',
      client: 'Claude Code',
    });
    expect(automationVersionStale(error)).toBeUndefined();
  });

  it('reads who saved the newer version, and leaves out what it cannot read', () => {
    const error = new AppError({
      code: 'AUTOMATION_VERSION_STALE',
      message: 'v6 was saved',
      latestVersion: 6,
      latestCreatedBy: 'user-ada',
      latestVia: 'a-door-from-the-future',
    });
    expect(automationVersionStale(error)).toEqual({
      version: 6,
      by: 'user-ada',
      at: null,
      via: null,
      client: null,
    });
    expect(automationDeploymentStale(error)).toBeUndefined();
  });
});
