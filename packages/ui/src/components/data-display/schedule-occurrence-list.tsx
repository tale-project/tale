'use client';

import { cn } from '@tale/ui/cn';
import { useT } from '@tale/ui/i18n/client';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import {
  formatOccurrence,
  formatZonedDate,
  formatZonedTime,
} from '../../lib/recurrence/format';
import {
  parseScheduleTime,
  type ScheduleOccurrence,
} from '../../lib/recurrence/schedule';
import {
  formatTimeOfDay,
  type HourCycle,
  localHourCycle,
} from '../../lib/time-of-day';
import { Badge } from '../feedback/badge';

export interface ScheduleOccurrenceListProps {
  /** The upcoming starts the host computed, earliest first. */
  occurrences: readonly ScheduleOccurrence[];
  /** How many to list. @default 5 */
  count?: number;
  /** `compact` is one small line per start with the zone in the header, for
   *  a popover; `full` adds the reader's own time when their zone differs.
   *  @default 'full' */
  variant?: 'compact' | 'full';
  /** The list's heading. @default "Next runs" */
  label?: string;
  /** Add the schedule's zone to the heading. @default true */
  showZone?: boolean;
  /** Starts that would happen but will not yet — a paused schedule, nothing
   *  deployed — read in the muted colour. */
  muted?: boolean;
  /** A start in another year shows its year. */
  referenceYear?: number;
  /** @default the locale's */
  hourCycle?: HourCycle;
  /** What an empty list says. @default "No upcoming runs." */
  emptyText?: string;
  /** The reader's zone, which their own times are written in.
   *  @default the browser's */
  viewerTimeZone?: string;
  id?: string;
  className?: string;
}

/** The zone's canonical name, so two spellings of one zone compare equal. */
function canonicalZone(zone: string): string {
  try {
    return new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions()
      .timeZone;
  } catch (error) {
    // An unknown zone stays as written; formatting in it is the host's
    // concern, and comparing it as text is the best this list can do.
    console.warn('[ScheduleOccurrenceList] unknown time zone', zone, error);
    return zone;
  }
}

/** The calendar day of an instant in a zone, as comparable text. */
function dayIn(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(at);
}

/**
 * The next starts of a schedule, written in the schedule's own zone — "Tue,
 * Oct 13, 9:00 AM" — with the zone in the heading. Where the reader's zone
 * differs, the full list adds their own time ("3:00 AM in your time zone")
 * and the compact list says which zone they are in. A start that meets a
 * clock change carries a **Clock change** badge and a line saying what
 * happens, never a tooltip alone.
 *
 * The list does no time-zone arithmetic: the host computes every start,
 * which zone it is in and how it met a clock change.
 */
export function ScheduleOccurrenceList({
  occurrences,
  count = 5,
  variant = 'full',
  label,
  showZone = true,
  muted = false,
  referenceYear,
  hourCycle,
  emptyText,
  viewerTimeZone,
  id,
  className,
}: ScheduleOccurrenceListProps) {
  const { t } = useT('recurrence');
  const { i18n } = useTranslation();
  const locale = i18n?.resolvedLanguage ?? i18n?.language ?? 'en';
  const cycle = hourCycle ?? localHourCycle(locale);
  const headingId = `${useId()}-heading`;
  const shown = occurrences.slice(0, Math.max(0, count));
  const zone = shown[0]?.timeZone;
  const viewer =
    viewerTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const viewerDiffers =
    zone !== undefined && canonicalZone(zone) !== canonicalZone(viewer);
  const heading = label ?? t('nextRuns');

  /** The reader's own time for a start, when it reads differently. */
  const localWords = (occurrence: ScheduleOccurrence): string | null => {
    if (!viewerDiffers || variant !== 'full') return null;
    const theirs = formatZonedTime(occurrence.at, viewer, locale, cycle);
    const sameDay =
      dayIn(occurrence.at, viewer) ===
      dayIn(occurrence.at, occurrence.timeZone);
    if (sameDay) {
      const ours = formatZonedTime(
        occurrence.at,
        occurrence.timeZone,
        locale,
        cycle,
      );
      return theirs === ours ? null : t('occurrences.local', { time: theirs });
    }
    return t('occurrences.localOtherDay', {
      date: formatZonedDate(occurrence.at, viewer, locale, referenceYear),
      time: theirs,
    });
  };

  /** What a clock change did to a start, in a sentence. */
  const clockWords = (occurrence: ScheduleOccurrence): string | null => {
    const change = occurrence.clockChange;
    if (change === undefined) return null;
    const actual = formatZonedTime(
      occurrence.at,
      occurrence.timeZone,
      locale,
      cycle,
    );
    if (change.kind === 'shiftedForward') {
      const wall = parseScheduleTime(change.wallTime);
      return t('occurrences.shiftedForward', {
        time:
          wall === null
            ? change.wallTime
            : formatTimeOfDay(wall, locale, cycle),
        actual,
      });
    }
    return change.interval
      ? t('occurrences.intervalRepeated')
      : t('occurrences.repeatedHour', { time: actual });
  };

  return (
    <div id={id} className={cn('flex min-w-0 flex-col gap-1', className)}>
      <p
        id={headingId}
        className={cn(
          'font-medium',
          variant === 'full' ? 'text-sm' : 'text-muted-foreground text-xs',
        )}
      >
        {showZone && zone !== undefined
          ? t('occurrences.inZone', { label: heading, zone })
          : heading}
      </p>
      {shown.length === 0 ? (
        <p
          className={cn(
            'text-muted-foreground',
            variant === 'full' ? 'text-sm' : 'text-xs',
          )}
        >
          {emptyText ?? t('occurrences.empty')}
        </p>
      ) : (
        // An explicit list role: Safari drops the list semantics of a list
        // styled without markers.
        <ol
          role="list"
          aria-labelledby={headingId}
          className={cn(
            'flex flex-col',
            variant === 'full'
              ? 'gap-1 text-sm leading-6'
              : 'text-xs leading-5',
            muted && 'text-muted-foreground',
          )}
        >
          {shown.map((occurrence, index) => {
            const local = localWords(occurrence);
            const clock = clockWords(occurrence);
            return (
              <li key={`${occurrence.at}-${index}`} className="flex flex-col">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="tabular-nums">
                    {formatOccurrence(occurrence, t, locale, {
                      referenceYear,
                      cycle,
                    })}
                  </span>
                  {/* Spaces between the parts, so they read as words; the
                      flex row lays them out with its own gap. */}
                  {local !== null && ' '}
                  {local !== null && (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {local}
                    </span>
                  )}
                  {clock !== null && ' '}
                  {clock !== null && (
                    <Badge variant="yellow" className="px-1.5 py-0">
                      {t('occurrences.clockChange')}
                    </Badge>
                  )}
                </div>
                {clock !== null && ' '}
                {clock !== null && (
                  <span className="text-muted-foreground text-xs leading-5">
                    {clock}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {variant === 'compact' && viewerDiffers && (
        <p className="text-muted-foreground text-xs">
          {t('occurrences.viewerZone', { zone: viewer })}
        </p>
      )}
    </div>
  );
}
