'use client';

import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { useT } from '@tale/ui/i18n/client';
import { Repeat } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { useRecurrenceFormat } from '../../hooks/use-recurrence-format';
import {
  type CalendarDay,
  matchRecurrencePreset,
  normalizeRecurrence,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_MAX_INTERVAL,
  RECURRENCE_PRESETS,
  type RecurrenceDraft,
  recurrenceDraft,
  type RecurrenceFrequency,
  recurrenceFromDraft,
  recurrencePreset,
  type RecurrencePreset,
  type RecurrenceReference,
  type RecurrenceRule,
  sameRecurrence,
  withRecurrenceFrequency,
} from '../../lib/recurrence/rule';
import { Popover } from '../overlays/popover';
import { RecurrenceEditor } from './recurrence-editor';
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
  SchedulePicker,
  type ScheduleRecurrencePickerProps,
} from './schedule-picker';

export type {
  ScheduleExtraContext,
  ScheduleRecurrencePickerProps,
} from './schedule-picker';

/** What `renderExtra` gets: the session's draft, and a way to change its extra. */
export interface RecurrenceExtraContext<Extra> {
  /** The draft rule — `null` while Never is picked. */
  rule: RecurrenceRule | null;
  /** The draft extra. */
  extra: Extra;
  setExtra: (next: Extra) => void;
}

interface DayPickerFields {
  /** Days, the default: how often something recurs, by calendar day. */
  granularity?: 'day';
  /** The saved rule. A host type with keys of its own is accepted; they are
   *  ignored, and never emitted back. */
  value: RecurrenceRule | null;
  /** The day the presets and a new custom rule are read off (the item's due
   *  date, else today), with its weekday worked out by the host. */
  reference: RecurrenceReference;
  /** The next dates a rule produces — the host's calendar arithmetic. The
   *  first three are listed; omit it and no dates are shown. */
  nextDates?: (rule: RecurrenceRule) => readonly CalendarDay[];
  /** @default "Next dates" */
  nextDatesLabel?: string;
  /** The one-click choices after Never. @default RECURRENCE_PRESETS */
  presets?: readonly RecurrencePreset[];
  /** The units the custom editor offers. @default every frequency */
  frequencies?: readonly RecurrenceFrequency[];
  /** The widest step the custom editor allows. @default 99 */
  maxInterval?: number;
}

export type DayRecurrencePickerProps<Extra = never> =
  RecurrencePickerSharedProps &
    DayPickerFields &
    (
      | {
          /** Called once per session, only when something changed. */
          onChange: (rule: RecurrenceRule | null) => void;
          extra?: never;
          renderExtra?: never;
        }
      | {
          /** Called once per session, only when the rule or the extra changed. */
          onChange: (rule: RecurrenceRule | null, extra: Extra) => void;
          /** A host option saved with the rule — its saved value. */
          extra: Extra;
          /** The host option's control, drafted and saved with the rule;
           *  rendered under the next dates in both views. */
          renderExtra: (context: RecurrenceExtraContext<Extra>) => ReactNode;
        }
    );

/**
 * The day picker's props, or — with `granularity="time"` — the schedule
 * picker's. `AllowNever` is `false` when the schedule picker is given
 * `allowNever={false}`, which makes its `value` and `onChange` non-null.
 */
export type RecurrencePickerProps<
  Extra = never,
  AllowNever extends boolean = true,
> =
  | DayRecurrencePickerProps<Extra>
  | ScheduleRecurrencePickerProps<Extra, AllowNever>;

const NEVER = 'never';
type Choice = RecurrencePreset | typeof NEVER;

type DaySession<Extra> = PickerSession<
  RecurrenceRule,
  'presets' | 'custom',
  RecurrenceDraft,
  Extra
>;

function savedExtra<Extra>(
  props: DayRecurrencePickerProps<Extra>,
): { value: Extra } | null {
  return props.renderExtra === undefined ? null : { value: props.extra };
}

function freshSession<Extra>(
  props: DayRecurrencePickerProps<Extra>,
): DaySession<Extra> {
  return {
    view: 'presets',
    rule: props.value ? normalizeRecurrence(props.value) : null,
    extra: savedExtra(props),
    editor: null,
  };
}

function emit<Extra>(
  props: DayRecurrencePickerProps<Extra>,
  rule: RecurrenceRule | null,
  extra: { value: Extra } | null,
): void {
  const normalized = rule ? normalizeRecurrence(rule) : null;
  if (props.renderExtra === undefined) {
    props.onChange(normalized);
    return;
  }
  props.onChange(normalized, extra ? extra.value : props.extra);
}

/** The Custom editor's starting draft: the rule's, on a unit the host offers. */
function seedEditor<Extra>(
  props: DayRecurrencePickerProps<Extra>,
  rule: RecurrenceRule | null,
): RecurrenceDraft {
  const frequencies = props.frequencies ?? RECURRENCE_FREQUENCIES;
  const draft = recurrenceDraft(
    rule,
    props.reference,
    props.maxInterval ?? RECURRENCE_MAX_INTERVAL,
  );
  const offered = frequencies.includes(draft.frequency)
    ? draft.frequency
    : frequencies[0];
  return offered && offered !== draft.frequency
    ? withRecurrenceFrequency(draft, offered)
    : draft;
}

/** How the day picker's session reads, compares and saves rules. */
function dayMachine<Extra>(): RecurrenceMachine<
  DayRecurrencePickerProps<Extra>,
  RecurrenceRule,
  DaySession<Extra>,
  Extra
> {
  return {
    value: (props) => props.value,
    savedExtra,
    same: sameRecurrence,
    fresh: freshSession,
    emit,
    // A clean draft follows new saved values; an open Custom view re-seeds.
    reseed: (live, current, saved) => {
      const editor =
        live.view === 'custom' ? seedEditor(current, current.value) : null;
      let rule: RecurrenceRule | null = null;
      if (editor) rule = recurrenceFromDraft(editor);
      else if (current.value) rule = normalizeRecurrence(current.value);
      return { ...live, rule, extra: saved, editor };
    },
  };
}

/**
 * How something repeats: a compact trigger ("↻ Weekly · Tue") that opens a
 * popover of one-click presets read off a reference day, plus a Custom view
 * that edits any rule in place.
 *
 * A preset saves and closes at once. Everything else — a custom rule, the
 * host's extra option — is a draft for the session: Save commits it with one
 * `onChange`, and Cancel, Escape or a click outside throw it away. The
 * package does no calendar arithmetic: the host supplies the reference day
 * and, if it wants them shown, the next dates a rule produces.
 *
 * With `granularity="time"` it picks a schedule instead: presets from every
 * 15 minutes to monthly, a Custom interval view (every N minutes or hours,
 * on some weekdays, between some hours) and a Custom times view (the day
 * editor plus times of day), with the next runs the host computes.
 */
export function RecurrencePicker<
  Extra = never,
  AllowNever extends boolean = true,
>(props: RecurrencePickerProps<Extra, AllowNever>) {
  return props.granularity === 'time' ? (
    <SchedulePicker<Extra> {...props} />
  ) : (
    <DayPicker<Extra> {...props} />
  );
}

function DayPicker<Extra>(props: DayRecurrencePickerProps<Extra>) {
  const {
    value,
    reference,
    label: labelProp,
    description,
    icon = Repeat,
    nextDates,
    nextDatesLabel,
    presets = RECURRENCE_PRESETS,
    frequencies = RECURRENCE_FREQUENCIES,
    maxInterval = RECURRENCE_MAX_INTERVAL,
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
  const label = labelProp ?? t('label');
  const baseId = useId();
  const ids = {
    description: `${baseId}-description`,
    customHeading: `${baseId}-custom-heading`,
    customLabel: `${baseId}-custom-label`,
    customRule: `${baseId}-custom-rule`,
    nextDates: `${baseId}-next-dates`,
  };

  // One machine for the component's life, so the session's callbacks keep
  // their identity.
  const [machine] = useState(dayMachine<Extra>);
  const {
    open,
    session,
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
  const customRowRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const focusAfterSwitch = useRef<'editor' | 'customRow' | null>(null);

  const pick = (choice: Choice) =>
    commit(
      choice === NEVER
        ? null
        : recurrencePreset(choice, propsRef.current.reference),
    );

  const enterCustom = () => {
    update((current) => {
      const editor =
        current.editor &&
        sameRecurrence(recurrenceFromDraft(current.editor), current.rule)
          ? current.editor
          : seedEditor(propsRef.current, current.rule);
      return {
        ...current,
        view: 'custom',
        editor,
        rule: recurrenceFromDraft(editor),
      };
    });
    focusAfterSwitch.current = 'editor';
  };

  const backToPresets = () => {
    update((current) => ({ ...current, view: 'presets' }));
    focusAfterSwitch.current = 'customRow';
  };

  const changeEditor = (editor: RecurrenceDraft) =>
    update((current) => ({
      ...current,
      editor,
      rule: recurrenceFromDraft(editor),
    }));

  const setExtra = (next: Extra) =>
    update((current) => ({ ...current, extra: { value: next } }));

  // Focus follows a switch of view: into the editor's unit, or back onto
  // the Custom row that opened it.
  useEffect(() => {
    const target = focusAfterSwitch.current;
    if (target === null) return;
    focusAfterSwitch.current = null;
    if (target === 'customRow') {
      customRowRef.current?.focus();
      return;
    }
    editorRef.current
      ?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
      ?.focus();
  }, [session.view]);

  const parts = pickerTrigger({
    sentence: value ? format.sentence(value) : null,
    compact: value ? format.compact(value) : null,
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

  const draftRule = session.rule;
  const checked: Choice | '' =
    draftRule === null
      ? NEVER
      : (matchRecurrencePreset(draftRule, reference, presets) ?? '');
  const isCustom = draftRule !== null && checked === '';
  const dirty = open && isDirty(session, props);
  const dates =
    open && draftRule && nextDates ? nextDates(draftRule).slice(0, 3) : [];
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
        {presetRow({
          choice: NEVER,
          label: format.never,
          checked: checked === NEVER,
          onPick: pick,
        })}
        {presets.map((preset) =>
          presetRow({
            choice: preset,
            label: format.sentence(recurrencePreset(preset, reference)),
            badge: preset === 'weekdays' ? t('workweekRange') : undefined,
            checked: checked === preset,
            onPick: pick,
          }),
        )}
      </ToggleGroupPrimitive.Root>
      <div className="border-border border-t p-1">
        {customRow({
          rowRef: customRowRef,
          label: t('custom'),
          labelId: ids.customLabel,
          ruleId: ids.customRule,
          rule: isCustom && draftRule ? format.sentence(draftRule) : null,
          onOpen: enterCustom,
        })}
      </div>
    </>
  );

  const customView = session.editor ? (
    <>
      {customHeader({
        headingId: ids.customHeading,
        title: t('custom'),
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
          save();
        }}
      >
        <div ref={editorRef}>
          <RecurrenceEditor
            aria-labelledby={ids.customHeading}
            draft={session.editor}
            onDraftChange={changeEditor}
            frequencies={frequencies}
            maxInterval={maxInterval}
            onSubmit={save}
          />
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
        contentClassName="w-72 max-w-(--radix-popover-content-available-width) p-0"
        onOpenAutoFocus={(event) => {
          // The checked choice, not the first one: arrows start from there.
          event.preventDefault();
          const checkedRow = listRef.current?.querySelector<HTMLElement>(
            '[aria-checked="true"]',
          );
          (checkedRow ?? customRowRef.current)?.focus();
        }}
        trigger={parts.trigger}
      >
        {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- keydown boundary for the whole popover, not a control */}
        <div className="flex flex-col" onKeyDown={popoverKeyDown(save)}>
          {session.view === 'custom' ? customView : presetView}
          {(dates.length > 0 || hasExtraNode) && (
            <div className="border-border flex flex-col gap-3 border-t p-3">
              {dates.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p
                    id={ids.nextDates}
                    className="text-muted-foreground text-xs font-medium"
                  >
                    {nextDatesLabel ?? t('nextDates')}
                  </p>
                  <ul aria-labelledby={ids.nextDates} className="text-xs">
                    {dates.map((day, index) => (
                      <li key={index} className="inline">
                        {index > 0 && <span aria-hidden="true">{' · '}</span>}
                        <span className="whitespace-nowrap">
                          {format.day(day, reference.year)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {hasExtraNode && extraNode}
            </div>
          )}
          {(session.view === 'custom' || dirty) &&
            pickerFooter({
              cancelLabel: tCommon('actions.cancel'),
              saveLabel: tCommon('actions.save'),
              onCancel: close,
              onSave: save,
            })}
        </div>
      </Popover>
      {parts.description}
    </>
  );
}
