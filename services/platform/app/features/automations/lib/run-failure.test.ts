import { loadLocale } from '@tale/ui/i18n/load-locale';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RUN_FAILURE_CODES } from '@/backend/core/automations/failure';
import {
  reasonFamily,
  STEP_FAILURE_META,
  STEP_FAILURE_REASONS,
  type StepFailureReason,
} from '@/lib/engine/core/record/failure';
import type { StepFailure } from '@/lib/engine/core/record/types';
import { i18n } from '@/tests/utils/i18n-all-languages';

import {
  failureParamsForText,
  type FailureTextContext,
  RUN_FAILURE_DERIVED_PARAMS,
  runFailureText,
  stepFailureText,
} from './run-failure';

/** What each param holds at its raising site, as the engine sets it. */
const SAMPLE: StepFailure['params'] = {
  field: 'input.query',
  expr: 'nodes.fetch.output.customer.email',
  key: 'email',
  base: 'undefined',
  chain: 'nodes.fetch.output.customer',
  source: 'fetch',
  name: 'nodez',
  callee: 'nodes.fetch.output.items.mapp',
  errorName: 'TypeError',
  detail: 'ENGINE ENGLISH',
  limitMs: 5000,
  kind: 'object',
  connector: 'github',
  action: 'github.list_issues',
  keyword: 'required',
  property: '/to',
  status: 404,
  model: 'claude-sonnet-5-5',
  providerCode: 'credit_exhausted',
  agentCode: 'turn_crashed',
  harness: 'claude-code',
  attempts: 3,
  automation: 'billing/dunning-reminder',
  version: 4,
  childPath: 'send_reminder',
  max: 8,
  limit: 10_000,
  message: 'the conversation was closed meanwhile',
};

/** The run-level code each reason's failure carries. */
function codeOf(reason: StepFailureReason): string {
  if (reason === 'LLM_PROVIDER') return 'credit_exhausted';
  if (reason === 'AGENT_FAILED') return 'turn_crashed';
  return reasonFamily(reason);
}

/** A failure of `reason` with every param it may carry, or only the ones it
 * always carries. */
function failureOf(reason: StepFailureReason, full: boolean): StepFailure {
  const meta = STEP_FAILURE_META[reason];
  const names = [
    ...meta.params,
    ...(meta.technical ?? []),
    ...(full ? (meta.optional ?? []) : []),
  ];
  return {
    code: codeOf(reason),
    reason,
    params: Object.fromEntries(names.map((name) => [name, SAMPLE[name]])),
    message: 'ENGINE ENGLISH',
  };
}

const LOCALES = ['en', 'de', 'fr', 'de-CH'] as const;

function context(locale: string): FailureTextContext {
  return { locale, t: i18n.getFixedT(locale, 'automationRuns') };
}

interface IcuFormat {
  options: { parseErrorHandler: (error: unknown) => unknown };
}

function icuFormat(): IcuFormat {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- i18next-icu registers itself as the instance's i18nFormat service
  return (i18n.services as unknown as { i18nFormat: IcuFormat }).i18nFormat;
}

// The ICU formatter answers a message it cannot format with the raw message;
// here it throws, so a missing value or a malformed translation fails.
let restore: ((error: unknown) => unknown) | undefined;
beforeAll(async () => {
  await loadLocale(i18n, 'de-CH');
  restore = icuFormat().options.parseErrorHandler;
  icuFormat().options.parseErrorHandler = (error) => {
    throw error;
  };
});
afterAll(() => {
  if (restore !== undefined) icuFormat().options.parseErrorHandler = restore;
});

function expectWords(parts: readonly string[], where: string): void {
  for (const part of parts) {
    expect(part.trim(), where).not.toBe('');
    // A key that did not resolve, or an argument left in the text.
    expect(part, where).not.toMatch(/codes\.|runFailure\.|\{[a-zA-Z]+\}/);
    expect(part, where).not.toContain('NaN');
    // The engine's English stays in the technical details.
    expect(part, where).not.toContain('ENGINE ENGLISH');
    expect(part, where).not.toMatch(/\bnone\b/);
  }
}

describe('stepFailureText — every reason in every language', () => {
  for (const locale of LOCALES) {
    it(`${locale}: renders title, explanation, cause and fix`, () => {
      for (const reason of STEP_FAILURE_REASONS) {
        for (const full of [true, false]) {
          const text = stepFailureText(
            failureOf(reason, full),
            context(locale),
          );
          const where = `${reason} (${full ? 'every param' : 'required only'})`;
          expect(text.known, where).toBe(true);
          expectWords(
            [text.title, text.explanation, text.cause, text.fix],
            where,
          );
        }
      }
    });
  }

  it('names things the way the canvas does, in the language’s quotes', () => {
    const en = context('en');
    const missing = stepFailureText(failureOf('EXPR_READ_MISSING', true), en);
    expect(missing.cause).toBe(
      'nodes.fetch.output.customer.email reads "email" of nodes.fetch.output.customer, which is missing. That value comes from what "Fetch" returned.',
    );
    expect(missing.fix).toContain('nodes.fetch.output.customer?.email');
    const de = stepFailureText(
      failureOf('CONNECTOR_AUTH', true),
      Object.assign(context('de'), {
        connectorLabel: (name: string) =>
          name === 'github' ? 'GitHub' : undefined,
        actionLabel: () => 'Issues auflisten',
      }),
    );
    expect(de.cause).toBe('GitHub antwortete auf „Issues auflisten“ mit 404.');
  });

  it('leads with the run-level code of a provider’s or an agent’s failure', () => {
    const provider = stepFailureText(
      failureOf('LLM_PROVIDER', true),
      context('en'),
    );
    expect(provider.title).toBe("The provider's credit is used up");
    expect(provider.cause).toBe('It happened calling claude-sonnet-5-5.');
    const agent = stepFailureText(failureOf('AGENT_FAILED', true), {
      ...context('en'),
      harnessLabel: () => 'Claude Code',
    });
    expect(agent.title).toBe('The agent stopped unexpectedly');
    expect(agent.cause).toBe('Claude Code stopped after 3 attempts.');
  });

  it('reads a reason this build does not know as the run’s code', () => {
    const text = stepFailureText(
      {
        code: 'connector_error',
        reason: 'CONNECTOR_FROM_THE_FUTURE',
        params: {},
        message: 'ENGINE ENGLISH',
      },
      context('fr'),
    );
    expect(text.known).toBe(false);
    expect(text.title).toBe('Un appel de service a échoué');
    expect(text.cause).toBe('');
  });
});

describe('failureParamsForText', () => {
  it('gives each reason exactly its own params and the derived ones', () => {
    for (const reason of STEP_FAILURE_REASONS) {
      const meta = STEP_FAILURE_META[reason];
      const technical = new Set(meta.technical ?? []);
      const own = [...meta.params, ...(meta.optional ?? [])].filter(
        (name) => !technical.has(name),
      );
      const values = failureParamsForText(
        failureOf(reason, true),
        context('en'),
      );
      expect(Object.keys(values).sort(), reason).toEqual(
        [...new Set([...own, ...RUN_FAILURE_DERIVED_PARAMS[reason]])].sort(),
      );
    }
  });

  it('words a limit, a property and a read that cannot fail', () => {
    const values = (reason: StepFailureReason, params: StepFailure['params']) =>
      failureParamsForText(
        { code: 'node_error', reason, params, message: '' },
        context('en'),
      );
    expect(values('CODE_TIMEOUT', { limitMs: 1500 }).limit).toBe('1.5 seconds');
    expect(
      values('CONNECTOR_INPUT_REFUSED', {
        connector: 'gmail',
        action: 'gmail.send',
        property: '/to/0',
      }).propertyLabel,
    ).toBe('"to.0"');
    expect(
      values('EXPR_READ_MISSING', {
        expr: 'x',
        key: 'first name',
        base: 'null',
        chain: 'input.person',
      }).suggestion,
    ).toBe('input.person?.["first name"]');
  });
});

describe('runFailureText', () => {
  for (const locale of LOCALES) {
    it(`${locale}: says every run code, and something for no code`, () => {
      for (const code of [...RUN_FAILURE_CODES, null, 'from_the_future']) {
        const text = runFailureText(code, context(locale));
        expect(text.known, String(code)).toBe(
          code !== null && code !== 'from_the_future',
        );
        expectWords([text.title, text.explanation, text.fix], String(code));
      }
    });
  }
});
