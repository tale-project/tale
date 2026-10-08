'use client';

import type { TriggerView } from '@tale/shared/schemas/automation-trigger';
import {
  type ScheduleRule,
  sameScheduleRule,
} from '@tale/shared/schemas/schedule-rule';
import { Field } from '@tale/ui/field';
import { Input } from '@tale/ui/input';
import { RecurrencePicker } from '@tale/ui/recurrence-picker';
import type { ScheduleOccurrence } from '@tale/ui/recurrence-schedule';
import { ScheduleOccurrenceList } from '@tale/ui/schedule-occurrence-list';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@tale/ui/searchable-select';
import { SegmentedControl } from '@tale/ui/segmented-control';
import { Select } from '@tale/ui/select';
import { Text } from '@tale/ui/text';
import { useRecurrenceFormat } from '@tale/ui/use-recurrence-format';
import { useSwapFade } from '@tale/ui/use-swap-fade';
import { CalendarClock } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { cronToScheduleRule } from '@/lib/automations/schedule/cron-rule';
import { useT } from '@/lib/i18n/client';
import { type CalendarDate, weekdayOf } from '@/lib/shared/calendar';
import { localDateIn } from '@/lib/shared/zoned-time';

import { useSchedulePreview } from '../hooks/use-schedule-preview';
import { listTimezoneOptions } from '../lib/timezones';
import { cronParseError, type TriggerDraft } from '../lib/trigger-draft';

/** Where the field is shown: the General tab, or the Blank wizard. */
export type TriggerSurface = 'panel' | 'wizard';

/** What the next runs are, beyond the schedule itself. */
export interface ScheduleRunState {
  /** The draft is what is stored. */
  clean: boolean;
  /** A version is deployed, so the starts will run it. */
  deployed: boolean;
  /** The stored trigger's next start, when the server knows it. */
  nextRunAt: number | null;
}

type FormatNote =
  | { kind: 'repeatNoCron'; sentence: string }
  | { kind: 'cronNotConvertible' };

const MUTED_HINT = 'text-muted-foreground text-xs';

/** The month and year a date falls in, as a reader says it. */
function monthWords(date: CalendarDate, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(date.year, date.month - 1, 1));
}

/**
 * The schedule of a schedule trigger: its form (a repeat rule picked in the
 * design system's picker, or a cron expression for the advanced case), the
 * time zone it reads in, what it does with runs it missed, and its next
 * runs from the platform's own evaluator.
 *
 * Switching between Repeat and Cron converts when one form says exactly
 * what the other does, and says so when it cannot; nothing is lost until
 * the save, because both drafts stay in the form.
 */
export function TriggerScheduleField({
  surface,
  draft,
  stored,
  canEdit,
  viewerZone,
  enabled,
  runState,
  onChange,
  fieldId,
}: {
  surface: TriggerSurface;
  draft: TriggerDraft;
  stored: TriggerView | null;
  canEdit: boolean;
  viewerZone: string;
  /** Whether the trigger starts runs (the Enabled switch, or Enable now). */
  enabled: boolean;
  runState: ScheduleRunState;
  onChange: (patch: Partial<TriggerDraft>) => void;
  /** The id of the schedule's control — the picker, or the cron field —
   * so a notice can hand focus to it. */
  fieldId?: string;
}) {
  const { t } = useT('automations');
  const format = useRecurrenceFormat();
  const ownId = useId();
  // One of the two controls is on screen at a time; both answer to it.
  const pickerId = fieldId ?? `${ownId}-picker`;
  const cronId = fieldId ?? `${ownId}-cron`;
  const [note, setNote] = useState<FormatNote | null>(null);
  const fadeRef = useSwapFade<HTMLDivElement>(draft.scheduleFormat, {
    fromEmpty: false,
  });
  const wizard = surface === 'wizard';
  const preview = useSchedulePreview(draft, stored, wizard ? 3 : 5);
  const zone = preview.zone ?? draft.timezone;

  const storedCron = stored?.kind === 'schedule' ? (stored.cron ?? '') : '';
  const storedCronRule =
    storedCron === '' || stored?.repeat != null
      ? null
      : cronToScheduleRule(storedCron);

  const switchFormat = (next: string) => {
    if (next !== 'repeat' && next !== 'cron') return;
    if (next === draft.scheduleFormat) return;
    if (next === 'cron') {
      // The stored expression, while the rule still says exactly it: a
      // flip to Cron and back changes nothing.
      const cron =
        storedCronRule !== null &&
        sameScheduleRule(draft.repeat, storedCronRule)
          ? storedCron
          : preview.ruleAsCron;
      if (cron === null) {
        setNote({
          kind: 'repeatNoCron',
          sentence: format.schedule(draft.repeat),
        });
        onChange({ scheduleFormat: 'cron' });
      } else {
        setNote(null);
        onChange({ scheduleFormat: 'cron', cron });
      }
      return;
    }
    const rule = preview.cronAsRule;
    if (rule === null) {
      setNote(draft.cron.trim() === '' ? null : { kind: 'cronNotConvertible' });
      onChange({ scheduleFormat: 'repeat' });
    } else {
      setNote(null);
      onChange({ scheduleFormat: 'repeat', repeat: rule });
    }
  };

  const timezoneOptions = useMemo<SearchableSelectOption[]>(
    () =>
      listTimezoneOptions(draft.timezone, viewerZone).map(
        (value): SearchableSelectOption =>
          value === viewerZone
            ? { value, label: value, description: t('trigger.timezoneYours') }
            : { value, label: value },
      ),
    [draft.timezone, viewerZone, t],
  );

  const today = localDateIn(Date.now(), preview.zone ?? viewerZone);
  const reference = { ...today, weekday: weekdayOf(today) };

  function anchorHint(
    rule: ScheduleRule,
    startDate: CalendarDate | null,
  ): string | null {
    if (startDate === null || rule.interval <= 1) return null;
    switch (rule.frequency) {
      case 'daily':
        return t('trigger.schedule.anchor.daily', {
          date: format.day(startDate),
        });
      case 'weekly':
        return t('trigger.schedule.anchor.weekly', {
          date: format.day(startDate),
        });
      case 'monthly':
        return t('trigger.schedule.anchor.monthly', {
          month: monthWords(startDate, format.locale),
        });
      case 'yearly':
        return t('trigger.schedule.anchor.yearly', { year: startDate.year });
      case 'minutely':
      case 'hourly':
        return null;
      default: {
        const exhaustive: never = rule;
        return exhaustive;
      }
    }
  }

  // Repeat: the rule as a sentence, where "every 2 weeks" counts from, and
  // what becomes of a stored cron.
  const repeatHints: string[] = [];
  if (draft.scheduleFormat === 'repeat') {
    repeatHints.push(format.schedule(draft.repeat));
    const anchor = anchorHint(draft.repeat, preview.startDate);
    if (anchor !== null) repeatHints.push(anchor);
    if (note?.kind === 'cronNotConvertible') {
      repeatHints.push(t('trigger.schedule.cronNotConvertible'));
    } else if (storedCronRule !== null) {
      repeatHints.push(t('trigger.schedule.savedAsCron', { cron: storedCron }));
    } else if (storedCron !== '' && stored?.repeat == null) {
      repeatHints.push(t('trigger.schedule.cronNotConvertible'));
    }
  }

  // Cron: the parser's refusal, or what the expression reads as.
  const cronText = draft.cron.trim();
  const cronError =
    draft.scheduleFormat === 'cron' && cronText !== ''
      ? cronParseError(cronText)
      : null;
  let cronDescription: string = t('trigger.cronHint');
  if (note?.kind === 'repeatNoCron') {
    cronDescription = t('trigger.schedule.repeatNoCron', {
      sentence: note.sentence,
    });
  } else if (cronText !== '' && preview.cronAsRule !== null) {
    cronDescription = t('trigger.schedule.cronReadsAs', {
      sentence: format.schedule(preview.cronAsRule),
    });
  }

  const zoneInvalid = preview.zone === null;

  // Next runs: what the scan will start, what it would start once the
  // trigger is on and a version deployed, or nothing to show.
  const unavailable = preview.occurrences === null;
  const wouldRun = !enabled || !runState.deployed;
  let header = t('trigger.nextRuns.title');
  if (!unavailable && wouldRun) header = t('trigger.nextRuns.wouldRun');
  else if (!unavailable && !runState.clean) {
    header = t('trigger.nextRuns.titleUnsaved');
  }
  let footnote: string | null = null;
  if (unavailable) footnote = t('trigger.nextRuns.unavailable');
  else if (!enabled) footnote = t('trigger.nextRuns.paused');
  else if (!runState.deployed) footnote = t('trigger.nextRuns.notDeployed');
  const occurrences = withServerNext(preview.occurrences ?? [], runState, zone);

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        label={t('trigger.schedule.format')}
        value={draft.scheduleFormat}
        onValueChange={switchFormat}
        options={[
          { value: 'repeat', label: t('trigger.schedule.formatRepeat') },
          { value: 'cron', label: t('trigger.schedule.formatCron') },
        ]}
        disabled={!canEdit}
      />
      <div ref={fadeRef}>
        {draft.scheduleFormat === 'repeat' ? (
          <Field
            label={t('trigger.schedule.label')}
            htmlFor={pickerId}
            description={t('trigger.schedule.description')}
          >
            <div className="flex min-w-0 flex-col gap-1">
              <RecurrencePicker
                granularity="time"
                allowNever={false}
                id={pickerId}
                variant="default"
                align="start"
                icon={CalendarClock}
                label={t('trigger.schedule.label')}
                description={t('trigger.schedule.inZone', { zone })}
                value={draft.repeat}
                reference={reference}
                nextOccurrences={preview.nextOccurrences}
                readOnly={!canEdit}
                modal={wizard}
                onChange={(repeat: ScheduleRule) => {
                  setNote(null);
                  onChange({ repeat });
                }}
              />
              {repeatHints.map((hint) => (
                <Text key={hint} as="p" className={MUTED_HINT}>
                  {hint}
                </Text>
              ))}
            </div>
          </Field>
        ) : (
          <Field
            label={t('trigger.cronLabel')}
            htmlFor={cronId}
            description={cronError === null ? cronDescription : undefined}
            error={
              cronError === null
                ? undefined
                : t('trigger.cronInvalidReason', { reason: cronError })
            }
          >
            <Input
              id={cronId}
              value={draft.cron}
              placeholder="0 */6 * * *"
              readOnly={!canEdit}
              onChange={(event) => {
                if (note?.kind === 'repeatNoCron') setNote(null);
                onChange({ cron: event.target.value });
              }}
              className="font-mono"
            />
          </Field>
        )}
      </div>
      <SearchableSelect
        label={t('trigger.timezoneLabel')}
        options={timezoneOptions}
        value={draft.timezone || null}
        onValueChange={(timezone) => onChange({ timezone })}
        disabled={!canEdit}
        searchPlaceholder={t('trigger.timezoneSearch')}
        emptyText={t('trigger.timezoneEmpty')}
        placeholder="UTC"
        error={zoneInvalid}
        {...(zoneInvalid && { description: t('trigger.timezoneInvalid') })}
        {...(wizard && { modal: true })}
      />
      {!wizard && (
        <Select
          label={t('trigger.catchUp.label')}
          description={t('trigger.catchUp.description')}
          hint={
            draft.catchUp === 'skip'
              ? t('trigger.catchUp.skipHint')
              : t('trigger.catchUp.latestHint')
          }
          options={[
            { value: 'latest', label: t('trigger.catchUp.latest') },
            { value: 'skip', label: t('trigger.catchUp.skip') },
          ]}
          value={draft.catchUp}
          onValueChange={(value) => {
            if (value === 'latest' || value === 'skip') {
              onChange({ catchUp: value });
            }
          }}
          disabled={!canEdit}
        />
      )}
      <div className="flex flex-col gap-1">
        {unavailable ? (
          <Text as="p" className="text-sm font-medium">
            {header}
          </Text>
        ) : (
          <ScheduleOccurrenceList
            occurrences={occurrences}
            count={wizard ? 3 : 5}
            label={header}
            muted={wouldRun}
            viewerTimeZone={viewerZone}
            referenceYear={today.year}
          />
        )}
        {footnote !== null && (
          <Text as="p" className={MUTED_HINT}>
            {footnote}
          </Text>
        )}
      </div>
    </div>
  );
}

/**
 * The listed starts with the server's next start first, when the form is
 * clean and that start is still ahead: it is the one the scan will fire,
 * a pending catch-up included. The rest stay as computed.
 */
function withServerNext(
  occurrences: readonly ScheduleOccurrence[],
  runState: ScheduleRunState,
  zone: string,
): readonly ScheduleOccurrence[] {
  const next = runState.nextRunAt;
  const first = occurrences[0];
  if (!runState.clean || next === null || next <= Date.now()) {
    return occurrences;
  }
  if (first !== undefined && first.at === next) return occurrences;
  return [
    { at: next, timeZone: first?.timeZone ?? zone },
    ...occurrences.filter((occurrence) => occurrence.at > next),
  ];
}
