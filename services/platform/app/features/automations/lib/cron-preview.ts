import { CronExpressionParser } from 'cron-parser';

import { parseCron } from '@/lib/automations/cron';

export type CronPreview =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'invalid';
      /** The validator's own sentence — the one the bind would answer with
       * — when it has one (`"61" is out of range (0..59)`). */
      readonly reason?: string;
    }
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
 *
 * The validation IS the bind's: `parseCron` — the parser the schedule matcher
 * fires on — judges the expression first, so the preview refuses exactly
 * what the save refuses (four or six fields, `MON`, a day no month has) and
 * never shows a "next run" beside a refusal. The packaged parser, which
 * accepts far more, only computes the next occurrence of an expression the
 * validator accepted.
 */
export function previewCronExpression(
  cron: string,
  timezone: string,
  now = new Date(),
): CronPreview {
  const trimmed = cron.trim();
  if (trimmed === '') return { kind: 'empty' };

  try {
    parseCron(trimmed);
  } catch (error) {
    return {
      kind: 'invalid',
      ...(error instanceof Error && error.message !== ''
        ? { reason: error.message }
        : {}),
    };
  }

  try {
    const interval = CronExpressionParser.parse(trimmed, {
      currentDate: now,
      ...(timezone.trim() !== '' && { tz: timezone.trim() }),
    });
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

/**
 * Whether `timezone` names a zone `Intl` resolves — the check the bind
 * makes (`wallClockIn` throws on an unknown zone), so a surface can refuse
 * `Mars/Olympus` before the save does.
 */
export function isValidTimezone(timezone: string): boolean {
  const trimmed = timezone.trim();
  if (trimmed === '') return false;
  try {
    return (
      new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).resolvedOptions()
        .timeZone !== ''
    );
  } catch (error) {
    // A RangeError names an unknown zone — the answer is "no", not a throw.
    if (!(error instanceof RangeError)) console.warn(error);
    return false;
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
