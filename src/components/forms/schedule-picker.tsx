'use client';

import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { useT } from '@tale/ui/i18n/client';
import { Repeat } from 'lucide-react';
import {
  Fragment,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { useRecurrenceFormat } from '../../hooks/use-recurrence-format';
import { useSwapFade } from '../../hooks/use-swap-fade';
import {
  RECURRENCE_FREQUENCIES,
  type RecurrenceFrequency,
  withRecurrenceFrequency,
} from '../../lib/recurrence/rule';
import {
  firstTime,
  type HourInterval,
  isScheduleGrid,
  matchSchedulePreset,
  type MinuteInterval,
  normalizeSchedule,
  sameSchedule,
  SCHEDULE_HOUR_INTERVALS,
  SCHEDULE_MAX_INTERVAL,
  SCHEDULE_MAX_TIMES,
  SCHEDULE_MINUTE_INTERVALS,
  SCHEDULE_PRESETS,
  type ScheduleDraft,
  scheduleDraft,
  scheduleFromDraft,
  scheduleKind,
  type ScheduleOccurrence,
  schedulePreset,
  type SchedulePreset,
  type ScheduleReference,
  type ScheduleRule,
  windowStarts,
} from '../../lib/recurrence/schedule';
import type { HourCycle } from '../../lib/time-of-day';
import { ScheduleOccurrenceList } from '../data-display/schedule-occurrence-list';
import { Popover } from '../overlays/popover';
import {
  customHeader,
  customRow,
  pickerFooter,
  pickerTrigger,
  popoverKeyDown,
  presetRow,
  type RecurrencePickerSharedProps,
} from './recurrence-picker-parts';
import {
  type PickerSession,
  type RecurrenceMachine,
  useRecurrenceSession,
} from './recurrence-session';
import {
  ScheduleIntervalEditor,
  ScheduleTimesEditor,
} from './schedule-editors';

/** What `renderExtra` gets in time mode: the draft schedule, and a way to
 *  change the extra. */
export interface ScheduleExtraContext<Extra> {
  /** The draft rule — `null` while Never is picked. */
  rule: ScheduleRule | null;
  /** The draft extra. */
  extra: Extra;
  setExtra: (next: Extra) => void;
}

/** A schedule picker's value: never null once Never is not offered. */
type ScheduleValue<AllowNever extends boolean> = AllowNever extends false
  ? ScheduleRule
  : ScheduleRule | null;

type CustomView = 'interval' | 'times';

interface ScheduleFields {
  /** Times of day: a schedule rather than calendar days. */
  granularity: 'time';
  /** The day the presets and a new custom rule are read off (today in the
   *  schedule's zone, worked out by the host), and the time of day the day
   *  presets start at when the saved rule names none. */
  reference: ScheduleReference;
  /** The one-click choices. @default SCHEDULE_PRESETS */
  presets?: readonly SchedulePreset[];
  /** The custom views offered, in order. @default ['interval', 'times'] */
  customViews?: readonly CustomView[];
  /** The units Custom times offers for the days. @default every frequency */
  frequencies?: readonly RecurrenceFrequency[];
  /** The minute steps Custom interval offers. @default every divisor of 60 */
  minuteIntervals?: readonly MinuteInterval[];
  /** The hour steps Custom interval offers. @default every divisor of 24 */
  hourIntervals?: readonly HourInterval[];
  /** The widest step of the days in Custom times. @default 99 */
  maxInterval?: number;
  /** The most times of day a rule may have. @default 12 */
  maxTimes?: number;
  /** @default the locale's */
  hourCycle?: HourCycle;
  /** @default "Next runs" */
  nextOccurrencesLabel?: string;
  nextDates?: never;
  nextDatesLabel?: never;
}

export type ScheduleRecurrencePickerProps<
  Extra = never,
  AllowNever extends boolean = true,
> = RecurrencePickerSharedProps &
  ScheduleFields & {
    /** The next starts the draft rule produces — the host's arithmetic,
     *  in the schedule's zone. The first three are listed; omit it and no
     *  starts are shown. */
    nextOccurrences?: (
      rule: ScheduleRule,
      extra: Extra,
    ) => readonly ScheduleOccurrence[];
    /** Offer Never. With `false`, `value` and `onChange` are never null.
     *  @default true */
    allowNever?: AllowNever;
    /** The saved rule. A host type with keys of its own is accepted; they
     *  are ignored, and never emitted back. */
    value: ScheduleValue<AllowNever>;
  } & (
    | {
        /** Called once per session, only when something changed. */
        onChange: (rule: ScheduleValue<AllowNever>) => void;
        extra?: never;
        renderExtra?: never;
      }
    | {
        /** Called once per session, only when the rule or the extra changed. */
        onChange: (rule: ScheduleValue<AllowNever>, extra: Extra) => void;
        /** A host option saved with the rule — its saved value. */
        extra: Extra;
        /** The host option's control, drafted and saved with the rule;
         *  rendered under the next runs in every view. */
        renderExtra: (context: ScheduleExtraContext<Extra>) => ReactNode;
      }
  );

/**
 * The props the picker runs on, whatever `allowNever` is. `onChange` is a
 * method, so a host's `(rule: ScheduleRule) => void` for a picker without
 * Never is accepted here too; the picker never emits null without Never.
 */
type SchedulePickerProps<Extra> = RecurrencePickerSharedProps &
  ScheduleFields & {
    nextOccurrences?(
      rule: ScheduleRule,
      extra?: Extra,
    ): readonly ScheduleOccurrence[];
    allowNever?: boolean;
    value: ScheduleRule | null;
  } & (
    | {
        onChange(rule: ScheduleRule | null): void;
        extra?: never;
        renderExtra?: never;
      }
    | {
        onChange(rule: ScheduleRule | null, extra: Extra): void;
        extra: Extra;
        renderExtra: (context: ScheduleExtraContext<Extra>) => ReactNode;
      }
  );

type ScheduleView = 'presets' | CustomView;
type ScheduleSession<Extra> = PickerSession<
  ScheduleRule,
  ScheduleView,
  ScheduleDraft,
  Extra
>;

const NEVER = 'never';
type Choice = SchedulePreset | typeof NEVER;
const CUSTOM_VIEWS: readonly CustomView[] = ['interval', 'times'];

/** The reference the presets read their time from: the saved rule's first
 *  time, so the list stays put while a draft changes. */
function presetReference(props: {
  value: ScheduleRule | null;
  reference: ScheduleReference;
}): ScheduleReference {
  const time = props.value ? firstTime(props.value) : undefined;
  return time === undefined ? props.reference : { ...props.reference, time };
}

/** A custom view's starting draft: the rule's, on the steps and units the
 *  host offers. */
function seedDraft<Extra>(
  props: SchedulePickerProps<Extra>,
  rule: ScheduleRule | null,
): ScheduleDraft {
  const draft = scheduleDraft(
    rule,
    presetReference(props),
    props.maxInterval ?? SCHEDULE_MAX_INTERVAL,
  );
  const frequencies = props.frequencies ?? RECURRENCE_FREQUENCIES;
  const minutes = props.minuteIntervals ?? SCHEDULE_MINUTE_INTERVALS;
  const hours = props.hourIntervals ?? SCHEDULE_HOUR_INTERVALS;
  const frequency = frequencies.includes(draft.calendar.frequency)
    ? draft.calendar.frequency
    : frequencies[0];
  const unit =
    draft.every.unit === 'hourly' && hours.length === 0
      ? 'minutely'
      : draft.every.unit === 'minutely' && minutes.length === 0
        ? 'hourly'
        : draft.every.unit;
  return {
    ...draft,
    calendar:
      frequency && frequency !== draft.calendar.frequency
        ? withRecurrenceFrequency(draft.calendar, frequency)
        : draft.calendar,
    every: {
      unit,
      minutes: minutes.includes(draft.every.minutes)
        ? draft.every.minutes
        : (minutes[0] ?? draft.every.minutes),
      hours: hours.includes(draft.every.hours)
        ? draft.every.hours
        : (hours[0] ?? draft.every.hours),
    },
  };
}

function savedExtra<Extra>(
  props: SchedulePickerProps<Extra>,
): { value: Extra } | null {
  return props.renderExtra === undefined ? null : { value: props.extra };
}

/** How the schedule picker's session reads, compares and saves rules. */
function scheduleMachine<Extra>(): RecurrenceMachine<
  SchedulePickerProps<Extra>,
  ScheduleRule,
  ScheduleSession<Extra>,
  Extra
> {
  return {
    value: (props) => props.value,
    savedExtra,
    same: sameSchedule,
    fresh: (props) => ({
      view: 'presets',
      rule: props.value ? normalizeSchedule(props.value) : null,
      extra: savedExtra(props),
      editor: null,
    }),
    emit: (props, rule, extra) => {
      const normalized = rule ? normalizeSchedule(rule) : null;
      if (props.renderExtra === undefined) {
        props.onChange(normalized);
        return;
      }
      props.onChange(normalized, extra ? extra.value : props.extra);
    },
    // A clean draft follows new saved values; an open custom view re-seeds.
    reseed: (live, current, saved) => {
      if (live.view === 'presets') {
        return {
          ...live,
          rule: current.value ? normalizeSchedule(current.value) : null,
          extra: saved,
          editor: null,
        };
      }
      const editor = seedDraft(current, current.value);
      return {
        ...live,
        rule: scheduleFromDraft(editor, live.view),
        extra: saved,
        editor,
      };
    },
  };
}

/** A grid whose hours no start falls in: it would never run. */
function neverFires(rule: ScheduleRule | null): boolean {
  return rule !== null && isScheduleGrid(rule) && windowStarts(rule) === null;
}

/**
 * The recurrence picker's time mode: a schedule — every 15 minutes, every
 * weekday at 9:00 and 17:30 — with the next runs the host computes. Its
 * presets save at once; Custom interval and Custom times are drafts that
 * Save commits.
 */
export function SchedulePicker<Extra>(props: SchedulePickerProps<Extra>) {
  const {
    value,
    label: labelProp,
    description,
    icon = Repeat,
    presets = SCHEDULE_PRESETS,
    customViews = CUSTOM_VIEWS,
    frequencies = RECURRENCE_FREQUENCIES,
    minuteIntervals = SCHEDULE_MINUTE_INTERVALS,
    hourIntervals = SCHEDULE_HOUR_INTERVALS,
    maxInterval = SCHEDULE_MAX_INTERVAL,
    maxTimes = SCHEDULE_MAX_TIMES,
    hourCycle,
    nextOccurrencesLabel,
    allowNever = true,
    disabled = false,
    disabledReason,
    readOnly = false,
    variant = 'ghost',
    align = 'end',
    modal = true,
    id,
    className,
  } = props;
  const { t } = useT('recurrence');
  const { t: tCommon } = useT('common');
  const format = useRecurrenceFormat();
  const cycle = hourCycle ?? format.hourCycle;
  const label = labelProp ?? t('scheduleLabel');
  const baseId = useId();
  const ids = {
    description: `${baseId}-description`,
    heading: `${baseId}-heading`,
    interval: `${baseId}-interval`,
    times: `${baseId}-times`,
  };

  // One machine for the component's life, so the session's callbacks keep
  // their identity.
  const [machine] = useState(scheduleMachine<Extra>);
  const {
    open,
    session,
    sessionRef,
    propsRef,
    triggerRef,
    tooltipGuard,
    update,
    isDirty,
    handleOpenChange,
    close,
    save,
    commit,
  } = useRecurrenceSession(props, machine);
  const listRef = useRef<HTMLDivElement>(null);
  const customRowRefs = useRef<Partial<Record<CustomView, HTMLButtonElement>>>(
    {},
  );
  const viewRef = useRef<HTMLDivElement>(null);
  const focusAfterSwitch = useRef<CustomView | 'editor' | null>(null);
  // Opacity only, and never on opening: the popover itself fades in.
  const fadeRef = useSwapFade<HTMLDivElement>(open ? session.view : undefined, {
    fromEmpty: false,
  });

  const blocked = neverFires(session.rule);
  // A window no start falls in never saves: Enter, Ctrl+Enter and Save all
  // stop here, and Save says why.
  const saveIfRuns = () => {
    if (neverFires(sessionRef.current.rule)) return;
    save();
  };

  const pick = (choice: Choice) =>
    commit(
      choice === NEVER
        ? null
        : schedulePreset(choice, presetReference(propsRef.current)),
    );

  const enterCustom = (view: CustomView) => {
    // The draft keeps both custom views' parts, so switching between them
    // loses nothing; the first custom view opened seeds it from the rule.
    update((current) => {
      const editor =
        current.editor ?? seedDraft(propsRef.current, current.rule);
      return {
        ...current,
        view,
        editor,
        rule: scheduleFromDraft(editor, view),
      };
    });
    focusAfterSwitch.current = 'editor';
  };

  const backToPresets = () => {
    const from = sessionRef.current.view;
    update((current) => ({ ...current, view: 'presets' }));
    focusAfterSwitch.current = from === 'presets' ? null : from;
  };

  const changeDraft = (editor: ScheduleDraft) =>
    update((current) => ({
      ...current,
      editor,
      rule:
        current.view === 'presets'
          ? current.rule
          : scheduleFromDraft(editor, current.view),
    }));

  const setExtra = (next: Extra) =>
    update((current) => ({ ...current, extra: { value: next } }));

  // Focus follows a switch of view: into the custom view's first control,
  // or back onto the row that opened it.
  useEffect(() => {
    const target = focusAfterSwitch.current;
    if (target === null) return;
    focusAfterSwitch.current = null;
    if (target !== 'editor') {
      customRowRefs.current[target]?.focus();
      return;
    }
    const view = viewRef.current;
    (
      view?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
      view?.querySelector<HTMLElement>('[role="combobox"]')
    )?.focus();
  }, [session.view]);

  const parts = pickerTrigger({
    sentence: value ? format.schedule(value, cycle) : null,
    compact: value ? format.scheduleCompact(value, cycle) : null,
    never: format.never,
    namePrefix: t('namePrefix', { label }),
    description,
    icon,
    disabled,
    disabledReason,
    variant,
    id,
    className,
    descriptionId: ids.description,
    triggerRef,
    tooltipGuard,
  });

  if (readOnly) return parts.readOnly;

  if (disabled) {
    return (
      <>
        {parts.trigger}
        {parts.description}
      </>
    );
  }

  const reference = presetReference(props);
  const draftRule = session.rule;
  const presetChoice =
    draftRule === null
      ? null
      : matchSchedulePreset(draftRule, reference, presets);
  const checked: Choice | '' =
    draftRule === null ? (allowNever ? NEVER : '') : (presetChoice ?? '');
  const customKind =
    draftRule !== null && presetChoice === null
      ? scheduleKind(draftRule)
      : null;
  const dirty = open && isDirty(session, props);
  let occurrences: readonly ScheduleOccurrence[] = [];
  if (open && draftRule !== null && props.nextOccurrences && !blocked) {
    occurrences = (
      session.extra === null
        ? props.nextOccurrences(draftRule)
        : props.nextOccurrences(draftRule, session.extra.value)
    ).slice(0, 3);
  }
  const extraNode =
    open && session.extra !== null && props.renderExtra !== undefined
      ? props.renderExtra({
          rule: draftRule,
          extra: session.extra.value,
          setExtra,
        })
      : null;
  const hasExtraNode =
    extraNode !== null && extraNode !== undefined && extraNode !== false;

  const customTitle = (view: CustomView) =>
    view === 'interval' ? t('customInterval') : t('customTimes');

  const presetView = (
    <>
      <ToggleGroupPrimitive.Root
        ref={listRef}
        type="single"
        orientation="vertical"
        loop
        value={checked}
        aria-label={t('presets')}
        className="flex flex-col p-1"
      >
        {allowNever &&
          presetRow({
            choice: NEVER,
            label: format.never,
            checked: checked === NEVER,
            onPick: pick,
          })}
        {presets.map((preset) =>
          presetRow({
            choice: preset,
            label: format.schedule(schedulePreset(preset, reference), cycle),
            badge: preset === 'weekdays' ? t('workweekRange') : undefined,
            checked: checked === preset,
            onPick: pick,
          }),
        )}
      </ToggleGroupPrimitive.Root>
      {customViews.length > 0 && (
        <div className="border-border border-t p-1">
          {customViews.map((view) => (
            <Fragment key={view}>
              {customRow({
                rowRef: (node) => {
                  if (node) customRowRefs.current[view] = node;
                  else delete customRowRefs.current[view];
                },
                label: customTitle(view),
                labelId: `${ids[view]}-label`,
                ruleId: `${ids[view]}-rule`,
                rule:
                  customKind === view && draftRule !== null
                    ? format.schedule(draftRule, cycle)
                    : null,
                onOpen: () => enterCustom(view),
              })}
            </Fragment>
          ))}
        </div>
      )}
    </>
  );

  const view = session.view;
  const customView =
    view !== 'presets' && session.editor ? (
      <>
        {customHeader({
          headingId: ids.heading,
          title: customTitle(view),
          backLabel: t('back'),
          onBack: backToPresets,
        })}
        <form
          noValidate
          className="p-3"
          onSubmit={(event) => {
            // Never the host's form: React bubbles submit through the portal.
            event.preventDefault();
            event.stopPropagation();
            saveIfRuns();
          }}
        >
          <div ref={viewRef}>
            {view === 'times' ? (
              <ScheduleTimesEditor
                aria-labelledby={ids.heading}
                draft={session.editor}
                onDraftChange={changeDraft}
                frequencies={frequencies}
                maxInterval={maxInterval}
                maxTimes={maxTimes}
                hourCycle={cycle}
                onSubmit={saveIfRuns}
              />
            ) : (
              <ScheduleIntervalEditor
                aria-labelledby={ids.heading}
                draft={session.editor}
                onDraftChange={changeDraft}
                minuteIntervals={minuteIntervals}
                hourIntervals={hourIntervals}
                hourCycle={cycle}
                onSubmit={saveIfRuns}
              />
            )}
          </div>
        </form>
      </>
    ) : null;

  return (
    <>
      <Popover
        open={open}
        onOpenChange={handleOpenChange}
        align={align}
        modal={modal}
        aria-label={label}
        contentClassName="w-80 max-w-(--radix-popover-content-available-width) p-0"
        onOpenAutoFocus={(event) => {
          // The checked choice, not the first one: arrows start from there.
          event.preventDefault();
          const checkedRow = listRef.current?.querySelector<HTMLElement>(
            '[aria-checked="true"]',
          );
          const customKindRow =
            customKind === null ? undefined : customRowRefs.current[customKind];
          (
            checkedRow ??
            customKindRow ??
            listRef.current?.querySelector<HTMLElement>('[role="radio"]')
          )?.focus();
        }}
        trigger={parts.trigger}
      >
        {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- keydown boundary for the whole popover, not a control */}
        <div className="flex flex-col" onKeyDown={popoverKeyDown(saveIfRuns)}>
          <div ref={fadeRef} className="flex flex-col">
            {view === 'presets' ? presetView : customView}
          </div>
          {(occurrences.length > 0 || hasExtraNode) && (
            <div className="border-border flex flex-col gap-3 border-t p-3">
              {occurrences.length > 0 && (
                <ScheduleOccurrenceList
                  occurrences={occurrences}
                  variant="compact"
                  count={3}
                  label={nextOccurrencesLabel}
                  referenceYear={props.reference.year}
                  hourCycle={cycle}
                />
              )}
              {hasExtraNode && extraNode}
            </div>
          )}
          {(view !== 'presets' || dirty) &&
            pickerFooter({
              cancelLabel: tCommon('actions.cancel'),
              saveLabel: tCommon('actions.save'),
              onCancel: close,
              onSave: saveIfRuns,
              blockedReason: blocked ? t('editor.windowHint.none') : undefined,
            })}
        </div>
      </Popover>
      {parts.description}
    </>
  );
}
