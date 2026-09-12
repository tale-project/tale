import { CronExpressionParser } from 'cron-parser';

import { impossibleCronDate } from '@/lib/automations/cron-feasibility';

export type CronPreview =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid' }
  | {
      readonly kind: 'ok';
      readonly nextAt: Date;
      /** Recognized common patterns for a plain-language line; otherwise null. */
      readonly pattern:
        | { readonly type: 'everyMinutes'; readonly n: number }
        | { readonly type: 'everyHours'; readonly n: number }
        | {
            readonly type: 'dailyAt';
            readonly hour: number;
            readonly minute: number;
          }
        | null;
    };

const EVERY_MINUTES = /^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/;
const EVERY_HOURS = /^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/;
const DAILY_AT = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/;

/**
 * Validate a 5-field cron and surface the next fire time (plus a short pattern
 * when the expression is one of a few common shapes). Used under the Cron field
 * so authors are not left reading a raw expression alone.
 */
export function previewCronExpression(
  cron: string,
  timezone: string,
  now = new Date(),
): CronPreview {
  const trimmed = cron.trim();
  if (trimmed === '') return { kind: 'empty' };

  try {
    const interval = CronExpressionParser.parse(trimmed, {
      currentDate: now,
      ...(timezone.trim() !== '' && { tz: timezone.trim() }),
    });
    // The parser's own feasibility check is narrower than the platform's
    // (it refuses `0 0 30 2 *` but walks decades ahead for `0 0 31 4,6 *`
    // and reports a fantasy date); the shared rule refuses exactly what the
    // bind refuses, so the preview never promises a schedule the save will
    // turn down.
    const numbers = (values: readonly unknown[]): number[] =>
      values.filter((value): value is number => typeof value === 'number');
    const impossible = impossibleCronDate({
      dayOfMonth: numbers(interval.fields.dayOfMonth.values),
      dayOfMonthWildcard: interval.fields.dayOfMonth.isWildcard,
      month: numbers(interval.fields.month.values),
      dayOfWeekWildcard: interval.fields.dayOfWeek.isWildcard,
    });
    if (impossible !== null) return { kind: 'invalid' };
    const nextAt = interval.next().toDate();

    let pattern: Extract<CronPreview, { kind: 'ok' }>['pattern'] = null;
    const everyMinutes = EVERY_MINUTES.exec(trimmed);
    if (everyMinutes) {
      pattern = { type: 'everyMinutes', n: Number(everyMinutes[1]) };
    } else {
      const everyHours = EVERY_HOURS.exec(trimmed);
      if (everyHours) {
        pattern = { type: 'everyHours', n: Number(everyHours[1]) };
      } else {
        const daily = DAILY_AT.exec(trimmed);
        if (daily) {
          // cron fields are minute hour — reverse of wall-clock order.
          pattern = {
            type: 'dailyAt',
            minute: Number(daily[1]),
            hour: Number(daily[2]),
          };
        }
      }
    }

    return { kind: 'ok', nextAt, pattern };
  } catch {
    return { kind: 'invalid' };
  }
}

/** Common IANA zones for the timezone combobox, UTC first; always includes `extra`. */
export function listTimezoneOptions(extra?: string): string[] {
  const supported =
    typeof Intl !== 'undefined' &&
    'supportedValuesOf' in Intl &&
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [
          'Europe/Zurich',
          'Europe/Berlin',
          'Europe/London',
          'America/New_York',
          'America/Los_Angeles',
          'Asia/Tokyo',
        ];

  const set = new Set<string>(['UTC', ...supported]);
  if (extra && extra.trim() !== '') set.add(extra.trim());

  const zones = [...set];
  zones.sort((a, b) => {
    if (a === 'UTC') return -1;
    if (b === 'UTC') return 1;
    return a.localeCompare(b);
  });
  return zones;
}
