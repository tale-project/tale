/**
 * How something repeats — which calendar days it recurs on — as the
 * recurrence picker reads and writes it.
 *
 * Pure and time-zone free: a rule names days (every Tuesday, the 30th of each
 * month), never instants. The host owns every piece of calendar arithmetic
 * that depends on a zone or a real calendar — stepping to the next
 * occurrence, clamping the 31st to a short month, working out which weekday
 * a date falls on — and hands the picker its results (`RecurrenceReference`,
 * `nextDates`). A host may carry keys of its own on a rule (a time zone, when
 * the next item is created); `normalizeRecurrence` strips them and
 * `sameRecurrence` ignores them.
 */

export const RECURRENCE_FREQUENCIES = [
  'daily',
  'weekly',
  'monthly',
  'yearly',
] as const;

export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/** Which calendar days something recurs on. */
export type RecurrenceRule =
  | { frequency: 'daily'; interval: number }
  | {
      frequency: 'weekly';
      interval: number;
      /** `Date#getDay` numbers: 0 is Sunday, 6 is Saturday. */
      weekdays: number[];
    }
  | {
      frequency: 'monthly';
      interval: number;
      /** 1–31; the host decides what a shorter month does with the 31st. */
      monthDay: number;
    }
  | {
      frequency: 'yearly';
      interval: number;
      /** 1 is January. */
      month: number;
      monthDay: number;
    };

/** A wall-calendar day; `month` is 1-based. */
export interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

/**
 * The day the presets and a new custom rule are read off — usually the item's
 * due date, else today. The host computes `weekday` (a `Date#getDay` number)
 * in its own zone; this module does no calendar arithmetic.
 */
export interface RecurrenceReference extends CalendarDay {
  weekday: number;
}

/** "Every 99 weeks" is the widest step the editor offers by default. */
export const RECURRENCE_MAX_INTERVAL = 99;

/** Monday to Friday, as `Date#getDay` numbers. */
export const RECURRENCE_WORKWEEK: readonly number[] = [1, 2, 3, 4, 5];

/**
 * A week the way the chips and every label read it: Monday first. Weeks run
 * Monday to Sunday, so "every 2 weeks on Monday and Sunday" names one week's
 * two ends.
 */
export const WEEKDAYS_MONDAY_FIRST: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

/** The one-click choices, in the order the picker lists them after Never. */
export const RECURRENCE_PRESETS = [
  'daily',
  'weekdays',
  'weekly',
  'monthly',
  'yearly',
] as const;

export type RecurrencePreset = (typeof RECURRENCE_PRESETS)[number];

/** Days in each month of a leap year, so February 29 is a valid anchor. */
const MAX_MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** The last day a month can have — February counts 29. */
export function maxMonthDay(month: number): number {
  return MAX_MONTH_DAYS[clamp(month, 1, 12) - 1] ?? 31;
}

/** Whether the days are exactly Monday to Friday. */
export function isWorkweek(weekdays: readonly number[]): boolean {
  const days = new Set(weekdays);
  return (
    days.size === RECURRENCE_WORKWEEK.length &&
    RECURRENCE_WORKWEEK.every((day) => days.has(day))
  );
}

/** The rule a preset means for an item read off `reference`. */
export function recurrencePreset(
  preset: RecurrencePreset,
  reference: RecurrenceReference,
): RecurrenceRule {
  switch (preset) {
    case 'daily':
      return { frequency: 'daily', interval: 1 };
    case 'weekdays':
      return {
        frequency: 'weekly',
        interval: 1,
        weekdays: [...RECURRENCE_WORKWEEK],
      };
    case 'weekly':
      return {
        frequency: 'weekly',
        interval: 1,
        weekdays: [reference.weekday],
      };
    case 'monthly':
      return { frequency: 'monthly', interval: 1, monthDay: reference.day };
    case 'yearly':
      return {
        frequency: 'yearly',
        interval: 1,
        month: reference.month,
        monthDay: reference.day,
      };
    default: {
      const exhaustive: never = preset;
      return exhaustive;
    }
  }
}

/** The preset a rule is, read off `reference`, or `null` for a custom rule. */
export function matchRecurrencePreset(
  rule: RecurrenceRule,
  reference: RecurrenceReference,
  presets: readonly RecurrencePreset[] = RECURRENCE_PRESETS,
): RecurrencePreset | null {
  return (
    presets.find((preset) =>
      sameRecurrence(recurrencePreset(preset, reference), rule),
    ) ?? null
  );
}

/**
 * The rule's own keys only, with its weekdays deduplicated and in `getDay`
 * order — the form a host stores and compares.
 */
export function normalizeRecurrence(rule: RecurrenceRule): RecurrenceRule {
  switch (rule.frequency) {
    case 'daily':
      return { frequency: 'daily', interval: rule.interval };
    case 'weekly':
      return {
        frequency: 'weekly',
        interval: rule.interval,
        weekdays: [...new Set(rule.weekdays)].toSorted((a, b) => a - b),
      };
    case 'monthly':
      return {
        frequency: 'monthly',
        interval: rule.interval,
        monthDay: rule.monthDay,
      };
    case 'yearly':
      return {
        frequency: 'yearly',
        interval: rule.interval,
        month: rule.month,
        monthDay: rule.monthDay,
      };
    default: {
      const exhaustive: never = rule;
      return exhaustive;
    }
  }
}

/**
 * Same frequency, step and anchors. Keys a host adds (a time zone, a creation
 * mode) take no part.
 */
export function sameRecurrence(
  a: RecurrenceRule | null | undefined,
  b: RecurrenceRule | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  if (a.frequency !== b.frequency || a.interval !== b.interval) return false;
  switch (a.frequency) {
    case 'daily':
      return true;
    case 'weekly': {
      if (b.frequency !== 'weekly') return false;
      const x = new Set(a.weekdays);
      const y = new Set(b.weekdays);
      return x.size === y.size && [...x].every((day) => y.has(day));
    }
    case 'monthly':
      return b.frequency === 'monthly' && a.monthDay === b.monthDay;
    case 'yearly':
      return (
        b.frequency === 'yearly' &&
        a.month === b.month &&
        a.monthDay === b.monthDay
      );
    default: {
      const exhaustive: never = a;
      return exhaustive;
    }
  }
}

/**
 * The custom editor's state. Every unit keeps an anchor of its own, so
 * switching from Month to Week and back does not lose the day of the month;
 * every field is always in range, so the draft always makes a valid rule.
 */
export interface RecurrenceDraft {
  frequency: RecurrenceFrequency;
  /** 1 to the editor's `maxInterval`. */
  interval: number;
  /** At least one `Date#getDay` number. */
  weekdays: number[];
  /** 1–31. */
  monthDay: number;
  /** 1–12. */
  yearMonth: number;
  /** 1 to `maxMonthDay(yearMonth)`. */
  yearDay: number;
}

/**
 * A draft from a rule, or — with no rule — weekly on the reference's weekday.
 * The units the rule does not use take their anchors from the reference.
 */
export function recurrenceDraft(
  rule: RecurrenceRule | null,
  reference: RecurrenceReference,
  maxInterval: number = RECURRENCE_MAX_INTERVAL,
): RecurrenceDraft {
  const referenceMonth = clamp(reference.month, 1, 12);
  const base: RecurrenceDraft = {
    frequency: 'weekly',
    interval: 1,
    weekdays: [clamp(reference.weekday, 0, 6)],
    monthDay: clamp(reference.day, 1, 31),
    yearMonth: referenceMonth,
    yearDay: clamp(reference.day, 1, maxMonthDay(referenceMonth)),
  };
  if (!rule) return base;
  const interval = clamp(rule.interval, 1, Math.max(1, maxInterval));
  switch (rule.frequency) {
    case 'daily':
      return { ...base, frequency: 'daily', interval };
    case 'weekly': {
      const weekdays = normalizeWeekdays(rule.weekdays);
      return {
        ...base,
        frequency: 'weekly',
        interval,
        weekdays: weekdays.length > 0 ? weekdays : base.weekdays,
      };
    }
    case 'monthly':
      return {
        ...base,
        frequency: 'monthly',
        interval,
        monthDay: clamp(rule.monthDay, 1, 31),
      };
    case 'yearly': {
      const yearMonth = clamp(rule.month, 1, 12);
      return {
        ...base,
        frequency: 'yearly',
        interval,
        yearMonth,
        yearDay: clamp(rule.monthDay, 1, maxMonthDay(yearMonth)),
      };
    }
    default: {
      const exhaustive: never = rule;
      return exhaustive;
    }
  }
}

/** The draft on another unit; the step is shared between units. */
export function withRecurrenceFrequency(
  draft: RecurrenceDraft,
  frequency: RecurrenceFrequency,
): RecurrenceDraft {
  return { ...draft, frequency };
}

/** The draft on another month of the year, its day clamped to fit. */
export function withRecurrenceMonth(
  draft: RecurrenceDraft,
  month: number,
): RecurrenceDraft {
  const yearMonth = clamp(month, 1, 12);
  return {
    ...draft,
    yearMonth,
    yearDay: clamp(draft.yearDay, 1, maxMonthDay(yearMonth)),
  };
}

function normalizeWeekdays(weekdays: readonly number[]): number[] {
  return [
    ...new Set(
      weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
    ),
  ].toSorted((a, b) => a - b);
}

/**
 * The rule a draft means, normalized. A draft out of range (built by hand
 * rather than by the editor) is clamped into range; an empty weekday list —
 * which the editor's chips never leave — reads as Monday, so the result is
 * always a valid rule.
 */
export function recurrenceFromDraft(draft: RecurrenceDraft): RecurrenceRule {
  const interval = clamp(draft.interval, 1, Number.MAX_SAFE_INTEGER);
  switch (draft.frequency) {
    case 'daily':
      return { frequency: 'daily', interval };
    case 'weekly': {
      const weekdays = normalizeWeekdays(draft.weekdays);
      return {
        frequency: 'weekly',
        interval,
        weekdays: weekdays.length > 0 ? weekdays : [1],
      };
    }
    case 'monthly':
      return {
        frequency: 'monthly',
        interval,
        monthDay: clamp(draft.monthDay, 1, 31),
      };
    case 'yearly': {
      const month = clamp(draft.yearMonth, 1, 12);
      return {
        frequency: 'yearly',
        interval,
        month,
        monthDay: clamp(draft.yearDay, 1, maxMonthDay(month)),
      };
    }
    default: {
      const exhaustive: never = draft.frequency;
      return exhaustive;
    }
  }
}
