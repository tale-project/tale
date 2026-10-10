import type { TriggerView } from '@tale/shared/schemas/automation-trigger';
import type { ScheduleRule } from '@tale/shared/schemas/schedule-rule';
import type { ScheduleOccurrence } from '@tale/ui/recurrence-schedule';
import { useMemo } from 'react';

import {
  cronToScheduleRule,
  scheduleRuleToCron,
} from '@/lib/automations/schedule/cron-rule';
import {
  scheduleOfTrigger,
  upcomingOccurrences,
} from '@/lib/automations/schedule/occurrences';
import {
  type CalendarDate,
  formatIsoDate,
  parseIsoDate,
} from '@/lib/shared/calendar';
import { canonicalTimeZone, localDateIn } from '@/lib/shared/zoned-time';

import {
  repeatStartDate,
  toTriggerBody,
  type TriggerDraft,
} from '../lib/trigger-draft';

/**
 * What a draft schedule will do, from the platform's own evaluator — the
 * one the scan fires on — so the starts a person is shown are the starts
 * the platform keeps. The preview reads the body a save would send: a
 * stored cron that is sent back unchanged previews as that cron, and a
 * repeat rule starts from the start date the save sends (today when it
 * sends none). The UI does no zone arithmetic of its own.
 */

export interface SchedulePreview {
  /** The next starts, or null when the draft names no schedule that runs
   * (a cron the parser refuses, an unknown zone, a rule that never
   * fires). */
  occurrences: readonly ScheduleOccurrence[] | null;
  /** The next starts of another rule in the draft's zone and from its
   * start date — for the picker's popover while a rule is drafted. */
  nextOccurrences: (rule: ScheduleRule) => readonly ScheduleOccurrence[];
  /** The draft's zone in its one spelling, or null when it names none. */
  zone: string | null;
  /** The day the draft's repeat rule counts from. */
  startDate: CalendarDate | null;
  /** The repeat rule the draft's cron says exactly, or null. */
  cronAsRule: ScheduleRule | null;
  /** The single cron expression the draft's repeat rule is, or null. */
  ruleAsCron: string | null;
}

/** The next `count` starts of `draft` as a save would send it. */
function draftOccurrences(
  draft: TriggerDraft,
  stored: TriggerView | null,
  zone: string | null,
  now: number,
  count: number,
): ScheduleOccurrence[] | null {
  if (zone === null) return null;
  const body = toTriggerBody(draft, stored, now);
  if (body.kind !== 'schedule') return null;
  const cron = body.cron ?? null;
  const read = scheduleOfTrigger({
    cron,
    timezone: zone,
    scheduleRule:
      body.repeat === undefined
        ? null
        : {
            repeat: body.repeat,
            startDate: body.startDate ?? formatIsoDate(localDateIn(now, zone)),
          },
  });
  if (!('schedule' in read)) return null;
  return upcomingOccurrences(read.schedule, now, count);
}

export function useSchedulePreview(
  draft: TriggerDraft,
  stored: TriggerView | null,
  count = 5,
): SchedulePreview {
  return useMemo(() => {
    const now = Date.now();
    const zone = canonicalTimeZone(draft.timezone);
    const today = zone === null ? null : localDateIn(now, zone);
    const startText = repeatStartDate(draft, stored, now);
    const startDate =
      (startText === null ? null : parseIsoDate(startText)) ?? today;
    return {
      occurrences: draftOccurrences(draft, stored, zone, now, count),
      nextOccurrences: (rule) =>
        draftOccurrences(
          { ...draft, scheduleFormat: 'repeat', repeat: rule },
          stored,
          zone,
          Date.now(),
          3,
        ) ?? [],
      zone,
      startDate,
      cronAsRule:
        draft.cron.trim() === '' ? null : cronToScheduleRule(draft.cron),
      ruleAsCron:
        startDate === null || today === null
          ? null
          : scheduleRuleToCron(draft.repeat, { startDate, today }),
    };
  }, [draft, stored, count]);
}
