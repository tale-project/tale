import {
  TRIGGER_ISSUE_CODES,
  type TriggerIssueCode,
} from '@tale/shared/schemas/automation-trigger';
import { SCHEDULE_MAX_TIMES } from '@tale/shared/schemas/schedule-rule';
import type { TFunction } from 'i18next';

import { automationErrorMessage, automationTriggerIssues } from './errors';
import type { TriggerDraftIssue } from './trigger-draft';

/**
 * A trigger problem as one sentence for its field, in the reader's
 * language. The doors refuse a trigger with dotted codes
 * (`schedule.times_required`), and the form finds two of its own before any
 * door (a cron the parser refuses, a fixed input that is not JSON); each
 * reads through one case of the switch below, so a new code fails the type
 * check until it has words.
 */

export interface TriggerIssueTextContext {
  /** Bound to the `automations` namespace. */
  t: TFunction;
  /** Bound to the `recurrence` namespace (the design system's). */
  tRecurrence: TFunction;
  locale: string;
}

export interface TriggerIssueParams {
  /** The reserved keys a fixed input named (`input.reserved_key`). */
  keys?: readonly string[];
  /** The cron parser's own sentence (`cron_invalid`). */
  cronReason?: string | null;
}

/** The sentence for one trigger problem. */
export function triggerIssueText(
  issue: TriggerDraftIssue,
  { t, tRecurrence, locale }: TriggerIssueTextContext,
  params: TriggerIssueParams = {},
): string {
  switch (issue) {
    case 'trigger.key_other_kind':
      return t('trigger.issues.keyOtherKind');
    case 'schedule.cron_or_repeat':
      return t('trigger.issues.schedule.cronOrRepeat');
    case 'schedule.cron_unreadable':
      return t('trigger.issues.schedule.cronUnreadable');
    case 'schedule.cron_impossible_date':
      return t('trigger.issues.schedule.cronImpossibleDate');
    case 'schedule.time_format':
      return t('trigger.issues.schedule.timeFormat');
    case 'schedule.times_required':
      return t('trigger.issues.schedule.timesRequired');
    case 'schedule.times_too_many':
      return t('trigger.issues.schedule.timesTooMany', {
        max: SCHEDULE_MAX_TIMES,
      });
    case 'schedule.interval_unsupported':
      return t('trigger.issues.schedule.intervalUnsupported');
    case 'schedule.month_day_impossible':
      return t('trigger.issues.schedule.monthDayImpossible');
    case 'schedule.window_hours_equal':
      return t('trigger.issues.schedule.windowHoursEqual');
    case 'schedule.window_never_fires':
      return tRecurrence('editor.windowHint.none');
    case 'schedule.start_date':
      return t('trigger.issues.schedule.startDate');
    case 'timezone.blank':
    case 'timezone.unknown':
    case 'timezone.required':
      return t('trigger.timezoneInvalid');
    case 'input.not_object':
      return t('trigger.issues.input.notObject');
    case 'input.reserved_key':
      return t('trigger.issues.input.reservedKey', {
        keys: new Intl.ListFormat(locale, {
          style: 'long',
          type: 'conjunction',
        }).format(params.keys ?? []),
      });
    case 'input.too_large':
      return t('trigger.issues.input.tooLarge');
    case 'input.unstorable_text':
      return t('trigger.issues.input.unstorableText');
    case 'event.required':
      return t('trigger.issues.event.required');
    case 'event.unknown':
      return t('trigger.issues.event.unknown');
    case 'cron_invalid':
      return params.cronReason
        ? t('trigger.cronInvalidReason', { reason: params.cronReason })
        : t('trigger.cronInvalid');
    case 'input_not_json':
      return t('trigger.fixedInput.notJson');
    default: {
      const exhaustive: never = issue;
      return exhaustive;
    }
  }
}

function isTriggerIssueCode(code: string): code is TriggerIssueCode {
  return (TRIGGER_ISSUE_CODES as readonly string[]).includes(code);
}

/** The reserved keys a refusal's message names in quotes. */
function quotedKeys(message: string): string[] {
  return [...message.matchAll(/"([^"]+)"/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/**
 * What a refused trigger save says to the reader: each coded problem in its
 * field's sentence, once; a problem without a known code in the server's own
 * words; any other refusal as the store's sentence.
 */
export function triggerRefusalText(
  error: unknown,
  ctx: TriggerIssueTextContext,
): string {
  const issues = automationTriggerIssues(error);
  if (issues === undefined) return automationErrorMessage(error);
  const sentences = issues.map((issue) =>
    isTriggerIssueCode(issue.code)
      ? triggerIssueText(issue.code, ctx, { keys: quotedKeys(issue.message) })
      : issue.message,
  );
  const unique = [...new Set(sentences.filter((text) => text !== ''))];
  return unique.length === 0 ? automationErrorMessage(error) : unique.join(' ');
}
