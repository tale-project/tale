/**
 * A span of time in the reader's words, from milliseconds: "320 ms",
 * "3.2 sec", "42 sec", "3 min, 12 sec", "2 hr, 5 min", "1 day, 3 hr" in
 * English; the locale picks the unit words and how two units join.
 *
 * Each unit is written by `Intl.NumberFormat` in its unit style and the
 * units are joined by `Intl.ListFormat` of type `unit` — the two steps
 * `Intl.DurationFormat` takes by its specification — so every engine says
 * the same words, those without `Intl.DurationFormat` included.
 */

export type DurationStyle = 'narrow' | 'short' | 'long';

export interface FormatDurationOptions {
  /** How units are written: `narrow` ("3m 12s"), `short` ("3 min, 12 sec",
   *  the default) or `long` ("3 minutes, 12 seconds"). */
  style?: DurationStyle;
  /**
   * `2` (the default): a duration of a minute or more reads in two units,
   * the smaller one whole ("3 min, 12 sec", "2 hr, 5 min"). `1`: the
   * largest unit alone, to one decimal ("3.2 min", "1.5 hours") — for a
   * limit or a narrow strip.
   */
  maxUnits?: 1 | 2;
}

type DurationUnit = 'day' | 'hour' | 'minute' | 'second' | 'millisecond';

interface DurationPart {
  unit: DurationUnit;
  value: number;
  /** Fraction digits the value is written with, at most. */
  digits: 0 | 1;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `value` rounded to one decimal. */
function tenths(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The units a duration reads in, largest first. */
export function durationParts(ms: number, maxUnits: 1 | 2 = 2): DurationPart[] {
  const total = Math.max(0, ms);
  if (Math.round(total) < SECOND) {
    return [{ unit: 'millisecond', value: Math.round(total), digits: 0 }];
  }
  const seconds = tenths(total / SECOND);
  if (seconds < 10) return [{ unit: 'second', value: seconds, digits: 1 }];
  const wholeSeconds = Math.round(total / SECOND);
  if (wholeSeconds < 60) {
    return [{ unit: 'second', value: wholeSeconds, digits: 0 }];
  }
  if (maxUnits === 1) {
    const minutes = tenths(total / MINUTE);
    if (minutes < 60) return [{ unit: 'minute', value: minutes, digits: 1 }];
    const hours = tenths(total / HOUR);
    if (hours < 24) return [{ unit: 'hour', value: hours, digits: 1 }];
    return [{ unit: 'day', value: tenths(total / DAY), digits: 1 }];
  }
  if (wholeSeconds < 3600) {
    return pair(
      'minute',
      Math.floor(wholeSeconds / 60),
      'second',
      wholeSeconds % 60,
    );
  }
  const wholeMinutes = Math.round(total / MINUTE);
  if (wholeMinutes < 24 * 60) {
    return pair(
      'hour',
      Math.floor(wholeMinutes / 60),
      'minute',
      wholeMinutes % 60,
    );
  }
  const wholeHours = Math.round(total / HOUR);
  return pair('day', Math.floor(wholeHours / 24), 'hour', wholeHours % 24);
}

/** A larger unit and a smaller one; a smaller one of zero is left out. */
function pair(
  unit: DurationUnit,
  value: number,
  smallUnit: DurationUnit,
  smallValue: number,
): DurationPart[] {
  const parts: DurationPart[] = [{ unit, value, digits: 0 }];
  if (smallValue > 0)
    parts.push({ unit: smallUnit, value: smallValue, digits: 0 });
  return parts;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
const listFormats = new Map<string, Intl.ListFormat>();

/** `locale` when the engine can read it, else English: a bad tag in a
 *  preference must not break every duration on a page. */
function usableLocale(locale: string): string {
  try {
    Intl.getCanonicalLocales(locale);
    return locale;
  } catch (error) {
    console.warn(`Unreadable locale "${locale}"; durations use English`, error);
    return 'en';
  }
}

function unitFormat(
  locale: string,
  style: DurationStyle,
  part: DurationPart,
): Intl.NumberFormat {
  const key = `${locale}|${style}|${part.unit}|${part.digits}`;
  let format = numberFormats.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: part.unit,
      unitDisplay: style,
      maximumFractionDigits: part.digits,
    });
    numberFormats.set(key, format);
  }
  return format;
}

function unitList(locale: string, style: DurationStyle): Intl.ListFormat {
  const key = `${locale}|${style}`;
  let format = listFormats.get(key);
  if (format === undefined) {
    format = new Intl.ListFormat(locale, { type: 'unit', style });
    listFormats.set(key, format);
  }
  return format;
}

/**
 * `ms` in the words of `locale`: under a second in milliseconds, under ten
 * seconds to a tenth of a second, under a minute in whole seconds, then in
 * two units (or one, with `maxUnits: 1`). A negative duration reads as
 * zero (two clocks that disagree); a value that is not a number reads "—".
 */
export function formatDuration(
  ms: number,
  locale: string,
  options: FormatDurationOptions = {},
): string {
  if (!Number.isFinite(ms)) return '—';
  const style = options.style ?? 'short';
  const tag = usableLocale(locale);
  const words = durationParts(ms, options.maxUnits ?? 2).map((part) =>
    unitFormat(tag, style, part).format(part.value),
  );
  return words.length === 1 ? words[0] : unitList(tag, style).format(words);
}

/**
 * `ms` as an HTML duration string (ISO 8601), for `<time dateTime>`:
 * `PT3.2S`, `PT3M12S`, `P1DT3H`. Milliseconds are kept, so the machine
 * reading gets the exact span the words round.
 */
export function durationIso(ms: number): string {
  if (!Number.isFinite(ms)) return 'PT0S';
  let rest = Math.round(Math.max(0, ms));
  const days = Math.floor(rest / DAY);
  rest -= days * DAY;
  const hours = Math.floor(rest / HOUR);
  rest -= hours * HOUR;
  const minutes = Math.floor(rest / MINUTE);
  rest -= minutes * MINUTE;
  const seconds = rest / SECOND;
  const time = [
    hours > 0 ? `${hours}H` : '',
    minutes > 0 ? `${minutes}M` : '',
    seconds > 0 || (days === 0 && hours === 0 && minutes === 0)
      ? `${Number(seconds.toFixed(3))}S`
      : '',
  ].join('');
  return `P${days > 0 ? `${days}D` : ''}${time === '' ? '' : `T${time}`}`;
}
