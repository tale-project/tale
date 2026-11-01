import { monthName } from '@tale/ui/recurrence-format';
import type { TFunction } from 'i18next';

import type { CronFieldName, CronProblem } from '@/lib/automations/cron';

/**
 * A cron expression the parser refuses, in the reader's language. The parse
 * (`lib/automations/cron.ts`) names what is wrong as facts — the kind, the
 * text as written, the field and the values it takes — and keeps its English
 * sentence for the bind's refusal, which the REST API and the CLI read. The
 * editors word those facts here, one catalog string per kind
 * (`trigger.cronProblems.*`), so a German author reads no English; a kind
 * the catalog has no words for reads as the plain refusal
 * (`trigger.cronInvalid`). `lib/i18n/cron-problem-keys.test.ts` holds every
 * kind to its words.
 */

export interface CronProblemTextContext {
  /** Bound to the `automations` namespace. */
  t: TFunction;
  locale: string;
}

/** The field a problem stands in, as the cron hint names it. */
function fieldLabel(field: CronFieldName, t: TFunction): string {
  switch (field) {
    case 'minute':
      return t('trigger.cronFields.minute');
    case 'hour':
      return t('trigger.cronFields.hour');
    case 'dayOfMonth':
      return t('trigger.cronFields.dayOfMonth');
    case 'month':
      return t('trigger.cronFields.month');
    case 'dayOfWeek':
      return t('trigger.cronFields.dayOfWeek');
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

/** A catalog string, or null when the catalog has none (`defaultValue: ''`). */
function worded(text: string): string | null {
  return text === '' ? null : text;
}

/**
 * Why the parser refused, as the clause `trigger.cronInvalidReason` frames;
 * null when the catalog has no words for the problem.
 */
export function cronProblemReason(
  problem: CronProblem,
  { t, locale }: CronProblemTextContext,
): string | null {
  switch (problem.kind) {
    case 'field_count':
      return worded(
        t('trigger.cronProblems.fieldCount', {
          count: problem.count,
          defaultValue: '',
        }),
      );
    case 'empty_entry':
      return worded(
        t('trigger.cronProblems.emptyEntry', {
          field: fieldLabel(problem.field, t),
          token: problem.token,
          defaultValue: '',
        }),
      );
    case 'invalid_step':
      return worded(
        t('trigger.cronProblems.invalidStep', {
          field: fieldLabel(problem.field, t),
          token: problem.token,
          defaultValue: '',
        }),
      );
    case 'not_a_range':
      return worded(
        t('trigger.cronProblems.notARange', {
          field: fieldLabel(problem.field, t),
          token: problem.token,
          defaultValue: '',
        }),
      );
    case 'out_of_range':
      return worded(
        t('trigger.cronProblems.outOfRange', {
          field: fieldLabel(problem.field, t),
          token: problem.token,
          min: problem.min,
          max: problem.max,
          defaultValue: '',
        }),
      );
    case 'matches_nothing':
      return worded(
        t('trigger.cronProblems.matchesNothing', {
          field: fieldLabel(problem.field, t),
          token: problem.token,
          defaultValue: '',
        }),
      );
    case 'impossible_date': {
      const either = new Intl.ListFormat(locale, { type: 'disjunction' });
      return worded(
        t('trigger.cronProblems.impossibleDate', {
          days: either.format(problem.days.map(String)),
          months: either.format(
            problem.months.map((month) => monthName(month, locale)),
          ),
          defaultValue: '',
        }),
      );
    }
    default: {
      // Every kind has a case; one added without words reads as the plain
      // refusal rather than as a sentence with a hole in it.
      const _unworded: never = problem;
      return null;
    }
  }
}

/**
 * The sentence for a cron expression the parser refuses: with its reason
 * when the problem is known and worded, otherwise the plain refusal.
 */
export function cronInvalidText(
  problem: CronProblem | null,
  ctx: CronProblemTextContext,
): string {
  const reason = problem === null ? null : cronProblemReason(problem, ctx);
  return reason === null
    ? ctx.t('trigger.cronInvalid')
    : ctx.t('trigger.cronInvalidReason', { reason });
}
