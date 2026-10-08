import { TRIGGER_ISSUE_CODES } from '@tale/shared/schemas/automation-trigger';
import { loadLocale } from '@tale/ui/i18n/load-locale';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { i18n } from '@/tests/utils/i18n-all-languages';

import type { TriggerDraftIssue } from './trigger-draft';
import {
  triggerIssueText,
  type TriggerIssueTextContext,
  triggerRefusalText,
} from './trigger-issue-text';

const LOCALES = ['en', 'de', 'fr', 'de-CH'] as const;

const ISSUES: readonly TriggerDraftIssue[] = [
  ...TRIGGER_ISSUE_CODES,
  'cron_invalid',
  'input_not_json',
];

function context(locale: string): TriggerIssueTextContext {
  return {
    locale,
    t: i18n.getFixedT(locale, 'automations'),
    tRecurrence: i18n.getFixedT(locale, 'recurrence'),
  };
}

interface IcuFormat {
  options: { parseErrorHandler: (error: unknown) => unknown };
}

// The ICU formatter answers a message it cannot format with the raw
// message; here it throws, so a missing value or a malformed translation
// fails.
let restore: ((error: unknown) => unknown) | undefined;
beforeAll(async () => {
  await loadLocale(i18n, 'de-CH');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- i18next-icu registers itself as the instance's i18nFormat service
  const format = (i18n.services as unknown as { i18nFormat: IcuFormat })
    .i18nFormat;
  restore = format.options.parseErrorHandler;
  format.options.parseErrorHandler = (error) => {
    throw error;
  };
});
afterAll(() => {
  if (restore === undefined) return;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- as above
  (
    i18n.services as unknown as { i18nFormat: IcuFormat }
  ).i18nFormat.options.parseErrorHandler = restore;
});

describe('triggerIssueText', () => {
  for (const locale of LOCALES) {
    it(`${locale}: says every trigger problem as a sentence`, () => {
      for (const issue of ISSUES) {
        const text = triggerIssueText(issue, context(locale), {
          keys: ['trigger', 'event'],
          cronReason: '"61" is out of range (0..59)',
        });
        expect(text, issue).not.toBe('');
        expect(text, issue).not.toMatch(/^(trigger|editor)\./);
        expect(text, issue).not.toMatch(/[{}]/);
      }
    });
  }

  it('names the reserved keys as a list in the reader’s language', () => {
    expect(
      triggerIssueText('input.reserved_key', context('en'), {
        keys: ['trigger', 'firedAt', 'event'],
      }),
    ).toBe(
      'Remove trigger, firedAt, and event: the trigger sets these fields itself.',
    );
    expect(
      triggerIssueText('input.reserved_key', context('de'), {
        keys: ['trigger', 'event'],
      }),
    ).toBe(
      'Entferne trigger und event: Diese Felder setzt der Trigger selbst.',
    );
  });

  it('reads every zone refusal as the one zone sentence', () => {
    const en = context('en');
    const sentence = triggerIssueText('timezone.unknown', en);
    expect(triggerIssueText('timezone.blank', en)).toBe(sentence);
    expect(triggerIssueText('timezone.required', en)).toBe(sentence);
  });

  it('says a window that never fires with the picker’s own words', () => {
    expect(triggerIssueText('schedule.window_never_fires', context('en'))).toBe(
      'No run falls between these times. Widen the hours or pick a shorter interval.',
    );
  });

  it('quotes the parser’s reason for a cron it refuses, when it has one', () => {
    expect(
      triggerIssueText('cron_invalid', context('en'), {
        cronReason: 'expected 5 fields, got 4',
      }),
    ).toBe('That cron expression is not valid: expected 5 fields, got 4');
    expect(triggerIssueText('cron_invalid', context('en'))).toBe(
      'That cron expression is not valid.',
    );
  });
});

describe('triggerRefusalText', () => {
  const refusal = (data: Record<string, unknown>) =>
    Object.assign(new Error('refused'), { data });

  it('says each coded problem once, and an unknown one in the server’s words', () => {
    expect(
      triggerRefusalText(
        refusal({
          code: 'AUTOMATION_TRIGGER_INVALID',
          message: 'The trigger is invalid.',
          issues: [
            { path: 'event', code: 'event.unknown', message: 'unknown' },
            { path: 'event', code: 'event.unknown', message: 'unknown' },
            { path: 'x', code: 'too_small', message: 'is too short' },
          ],
        }),
        context('en'),
      ),
    ).toBe("Tale doesn't raise this event. is too short");
  });

  it('falls back to the store’s sentence for a refusal without problems', () => {
    expect(
      triggerRefusalText(
        refusal({
          code: 'AUTOMATION_NOT_FOUND',
          message: 'No such automation.',
        }),
        context('en'),
      ),
    ).toBe('No such automation.');
  });
});
