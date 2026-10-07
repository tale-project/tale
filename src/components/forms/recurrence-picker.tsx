'use client';

import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cn } from '@tale/ui/cn';
import { useT } from '@tale/ui/i18n/client';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
  Repeat,
} from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { useRecurrenceFormat } from '../../hooks/use-recurrence-format';
import { useTriggerTooltipGuard } from '../../hooks/use-trigger-tooltip-guard';
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
import { structuralEqual } from '../../lib/structural-equal';
import { hasDisabledReason } from '../overlays/disabled-reason';
import { Popover } from '../overlays/popover';
import { Button } from '../primitives/button';
import { IconButton } from '../primitives/icon-button';
import { OPTION_ROW_CLASSES, OPTION_ROW_INSET } from './option-row';
import { RecurrenceEditor } from './recurrence-editor';

/** What `renderExtra` gets: the session's draft, and a way to change its extra. */
export interface RecurrenceExtraContext<Extra> {
  /** The draft rule — `null` while Never is picked. */
  rule: RecurrenceRule | null;
  /** The draft extra. */
  extra: Extra;
  setExtra: (next: Extra) => void;
}

interface RecurrencePickerBaseProps {
  /** The saved rule. A host type with keys of its own is accepted; they are
   *  ignored, and never emitted back. */
  value: RecurrenceRule | null;
  /** The day the presets and a new custom rule are read off (the item's due
   *  date, else today), with its weekday worked out by the host. */
  reference: RecurrenceReference;
  /** The control's name: the trigger's hidden prefix and the popover's
   *  name. @default "Repeat" */
  label?: string;
  /** A second line under the rule in the tooltip and the accessible
   *  description, while a rule is set. */
  description?: string;
  /** @default Repeat */
  icon?: LucideIcon;
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
  /** With a `disabledReason`, the trigger stays focusable (`aria-disabled`)
   *  and explains itself; without one it is natively disabled. */
  disabled?: boolean;
  disabledReason?: ReactNode;
  /** The rule as plain text, with no control at all. */
  readOnly?: boolean;
  /** `ghost` fits a property list's `h-7` row; `default` is an `h-9`
   *  outlined field for forms. @default 'ghost' */
  variant?: 'ghost' | 'default';
  /** @default 'end' */
  align?: 'start' | 'center' | 'end';
  /** Traps focus and makes the page inert while open; keep it on inside a
   *  Dialog, Sheet or Drawer, whose scroll lock otherwise swallows the
   *  popover's wheel events. @default true */
  modal?: boolean;
  /** Id of the trigger. */
  id?: string;
  className?: string;
}

export type RecurrencePickerProps<Extra = never> = RecurrencePickerBaseProps &
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

const NEVER = 'never';
type Choice = RecurrencePreset | typeof NEVER;

/** One popover session: the draft that Save commits and Cancel discards. */
interface Session<Extra> {
  view: 'presets' | 'custom';
  rule: RecurrenceRule | null;
  /** The drafted host extra; `null` when the host has none. */
  extra: { value: Extra } | null;
  /** The custom editor's state, once the Custom view has been opened. */
  editor: RecurrenceDraft | null;
}

function savedExtra<Extra>(
  props: RecurrencePickerProps<Extra>,
): { value: Extra } | null {
  return props.renderExtra === undefined ? null : { value: props.extra };
}

function freshSession<Extra>(
  props: RecurrencePickerProps<Extra>,
): Session<Extra> {
  return {
    view: 'presets',
    rule: props.value ? normalizeRecurrence(props.value) : null,
    extra: savedExtra(props),
    editor: null,
  };
}

function extraChanged<Extra>(
  draft: { value: Extra } | null,
  saved: { value: Extra } | null,
): boolean {
  return (
    draft !== null &&
    saved !== null &&
    !structuralEqual(draft.value, saved.value)
  );
}

function isDirty<Extra>(
  session: Session<Extra>,
  props: RecurrencePickerProps<Extra>,
): boolean {
  return (
    !sameRecurrence(session.rule, props.value) ||
    extraChanged(session.extra, savedExtra(props))
  );
}

function emit<Extra>(
  props: RecurrencePickerProps<Extra>,
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
  props: RecurrencePickerProps<Extra>,
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

const ROW_CLASSES = cn(
  OPTION_ROW_CLASSES,
  OPTION_ROW_INSET,
  'hover:bg-accent focus-visible:bg-accent outline-none',
);

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
 */
export function RecurrencePicker<Extra = never>(
  props: RecurrencePickerProps<Extra>,
) {
  const {
    value,
    reference,
    label: labelProp,
    description,
    icon: Icon = Repeat,
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

  const [open, setOpen] = useState(false);
  const [session, setSessionState] = useState<Session<Extra>>(() =>
    freshSession(props),
  );
  // The latest session and props, for handlers that run several steps in one
  // event (Enter in a number field commits the number, then saves).
  const sessionRef = useRef(session);
  const propsRef = useRef(props);
  // Event handlers must see committed props, never props from a concurrent
  // render that React later discards.
  useLayoutEffect(() => {
    propsRef.current = props;
  });
  // False from the moment a session ends, so one event can never save twice.
  const openRef = useRef(false);
  // The saved values the open session last took in, to tell a clean draft
  // (follows new values) from a dirty one (kept) when the props change.
  const syncedRef = useRef<{
    value: RecurrenceRule | null;
    extra: { value: Extra } | null;
  }>({ value: null, extra: null });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const customRowRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const focusAfterSwitch = useRef<'editor' | 'customRow' | null>(null);
  const tooltipGuard = useTriggerTooltipGuard(open);
  const suppressTooltipOpen = tooltipGuard.suppressNextOpen;

  const update = useCallback(
    (change: (current: Session<Extra>) => Session<Extra>) => {
      const next = change(sessionRef.current);
      sessionRef.current = next;
      setSessionState(next);
    },
    [],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        const current = propsRef.current;
        if (current.disabled || current.readOnly) return;
        const fresh = freshSession(current);
        sessionRef.current = fresh;
        setSessionState(fresh);
        syncedRef.current = {
          value: current.value,
          extra: savedExtra(current),
        };
        openRef.current = true;
        setOpen(true);
        return;
      }
      openRef.current = false;
      setOpen(false);
      suppressTooltipOpen();
    },
    [suppressTooltipOpen],
  );
  const close = useCallback(() => handleOpenChange(false), [handleOpenChange]);

  const save = useCallback(() => {
    if (!openRef.current) return;
    const current = propsRef.current;
    const draft = sessionRef.current;
    if (isDirty(draft, current)) emit(current, draft.rule, draft.extra);
    close();
  }, [close]);

  const pick = (choice: Choice) => {
    if (!openRef.current) return;
    const current = propsRef.current;
    const draft = sessionRef.current;
    if (choice === NEVER) {
      if (current.value) emit(current, null, draft.extra);
      close();
      return;
    }
    const rule = recurrencePreset(choice, current.reference);
    if (
      !sameRecurrence(rule, current.value) ||
      extraChanged(draft.extra, savedExtra(current))
    ) {
      emit(current, rule, draft.extra);
    }
    close();
  };

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

  // New saved values while the popover is open: a clean draft follows them,
  // a dirty one is kept (the last save wins). Runs after every render; the
  // comparison makes it a no-op unless a saved value really changed.
  useEffect(() => {
    if (!open) return;
    const current = propsRef.current;
    const saved = savedExtra(current);
    const previous = syncedRef.current;
    if (
      sameRecurrence(previous.value, current.value) &&
      !extraChanged(previous.extra, saved)
    ) {
      return;
    }
    syncedRef.current = { value: current.value, extra: saved };
    const draft = sessionRef.current;
    const clean =
      sameRecurrence(draft.rule, previous.value) &&
      !extraChanged(draft.extra, previous.extra);
    if (!clean) return;
    update((live) => {
      const editor =
        live.view === 'custom' ? seedEditor(current, current.value) : null;
      let rule: RecurrenceRule | null = null;
      if (editor) rule = recurrenceFromDraft(editor);
      else if (current.value) rule = normalizeRecurrence(current.value);
      return { ...live, rule, extra: saved, editor };
    });
  });

  // A control that turns disabled or read-only takes its popover with it.
  // The popover's focus return aimed at the trigger it unmounted with, so
  // put focus back on the one that replaced it rather than on the page.
  useEffect(() => {
    if ((disabled || readOnly) && openRef.current) {
      openRef.current = false;
      setOpen(false);
      if (
        document.activeElement === null ||
        document.activeElement === document.body
      ) {
        triggerRef.current?.focus();
      }
    }
  }, [disabled, readOnly]);

  const sentence = value ? format.sentence(value) : null;
  const compact = value ? format.compact(value) : null;
  const reason =
    disabled && hasDisabledReason(disabledReason) ? disabledReason : undefined;
  const hostDescription = value && description ? description : undefined;
  const hasDescription =
    sentence !== null || hostDescription !== undefined || reason !== undefined;
  const tip = hasDescription ? (
    <span className="flex flex-col gap-0.5">
      {sentence !== null && <span>{sentence}</span>}
      {hostDescription !== undefined && <span>{hostDescription}</span>}
      {reason !== undefined && <span>{reason}</span>}
    </span>
  ) : undefined;

  // "Repeat: Weekly, Tue" — the visible words behind the control's name, so
  // a voice command that reads the label out finds it.
  const visibleText = compact
    ? [compact.head, compact.tail].filter(Boolean).join(', ')
    : format.never;
  const accessibleName = `${t('namePrefix', { label })} ${visibleText}`;

  // One line whatever the width: a tail that does not fit wraps onto a
  // second line the box hides, so it leaves whole rather than mid-word.
  const icon = (
    <Icon
      className="text-muted-foreground size-4 shrink-0"
      aria-hidden="true"
    />
  );
  const text = (
    <span className="flex h-5 min-w-0 flex-wrap overflow-hidden leading-5">
      {compact ? (
        <>
          <span className="max-w-full truncate">{compact.head}</span>
          {compact.tail !== undefined && (
            <span className="whitespace-nowrap">
              {'\u00a0·\u00a0'}
              {compact.tail}
            </span>
          )}
        </>
      ) : (
        <span className="text-muted-foreground max-w-full truncate">
          {format.never}
        </span>
      )}
    </span>
  );

  if (readOnly) {
    // Plain text: the full sentence for assistive technology, the compact
    // line (and the sentence on hover) for sight.
    return (
      <span
        id={id}
        title={sentence ?? undefined}
        className={cn(
          'inline-flex w-full min-w-0 items-center gap-1.5 text-sm',
          variant === 'ghost' ? 'h-7 px-1.5' : 'h-9 px-2',
          className,
        )}
      >
        {icon}
        <span aria-hidden="true" className="flex min-w-0">
          {text}
        </span>
        <span className="sr-only">{sentence ?? format.never}</span>
      </span>
    );
  }

  const trigger = (
    <Button
      ref={triggerRef}
      id={id}
      type="button"
      variant="ghost"
      disabled={disabled}
      disabledReason={reason !== undefined ? tip : undefined}
      tooltip={disabled ? undefined : tip}
      tooltipOpen={tooltipGuard.open}
      onTooltipOpenChange={tooltipGuard.onOpenChange}
      aria-label={accessibleName}
      aria-describedby={hasDescription ? ids.description : undefined}
      className={cn(
        'w-full min-w-0 justify-start gap-1.5 text-sm font-normal',
        variant === 'ghost'
          ? 'h-7 px-1.5'
          : 'ring-border h-9 rounded-md px-2 ring-1',
        // Locked is not dimmed: the rule stays readable at full contrast
        // and the tooltip says why it cannot change.
        reason !== undefined &&
          'hover:bg-transparent aria-disabled:cursor-default aria-disabled:opacity-100 aria-disabled:hover:opacity-100',
        className,
      )}
    >
      {icon}
      {text}
    </Button>
  );

  // Read by assistive technology whether or not the tooltip is open. One
  // run of text, so every engine hears the spaces between the lines.
  const descriptionText = [sentence, hostDescription]
    .filter((part) => part !== null && part !== undefined)
    .join(' ');
  const descriptionNode = hasDescription ? (
    <span id={ids.description} hidden>
      {descriptionText}
      {descriptionText !== '' && reason !== undefined && ' '}
      {reason}
    </span>
  ) : null;

  if (disabled) {
    return (
      <>
        {trigger}
        {descriptionNode}
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

  // Enter never leaves the popover: React bubbles it through the portal to
  // whatever form or shortcut the host wraps the picker in.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter') return;
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      save();
    }
  };

  const presetRow = (choice: Choice, rowLabel: string, badge?: string) => (
    <ToggleGroupPrimitive.Item
      key={choice}
      value={choice}
      onClick={() => pick(choice)}
      className={cn(ROW_CLASSES, 'items-center')}
    >
      <span className="min-w-0 flex-1">{rowLabel}</span>
      {badge !== undefined && (
        <span
          aria-hidden="true"
          className="text-muted-foreground shrink-0 text-xs"
        >
          {badge}
        </span>
      )}
      <Check
        aria-hidden="true"
        className={cn(
          'text-primary size-4 shrink-0',
          checked !== choice && 'invisible',
        )}
      />
    </ToggleGroupPrimitive.Item>
  );

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
        {presetRow(NEVER, format.never)}
        {presets.map((preset) =>
          presetRow(
            preset,
            format.sentence(recurrencePreset(preset, reference)),
            preset === 'weekdays' ? t('workweekRange') : undefined,
          ),
        )}
      </ToggleGroupPrimitive.Root>
      <div className="border-border border-t p-1">
        <button
          ref={customRowRef}
          type="button"
          onClick={enterCustom}
          aria-labelledby={ids.customLabel}
          aria-describedby={isCustom ? ids.customRule : undefined}
          className={cn(ROW_CLASSES, 'items-start')}
        >
          <span className="min-w-0 flex-1">
            <span id={ids.customLabel} className="block">
              {t('custom')}
            </span>
            {isCustom && draftRule && (
              <span
                id={ids.customRule}
                className="text-muted-foreground line-clamp-2 block text-xs"
              >
                {format.sentence(draftRule)}
              </span>
            )}
          </span>
          {isCustom && (
            <Check
              aria-hidden="true"
              className="text-primary mt-0.5 size-4 shrink-0"
            />
          )}
          <ChevronRight
            aria-hidden="true"
            className="text-muted-foreground mt-0.5 size-4 shrink-0"
          />
        </button>
      </div>
    </>
  );

  const customView = session.editor ? (
    <>
      <div className="border-border flex items-center gap-1 border-b p-1">
        <IconButton
          icon={ChevronLeft}
          size="sm"
          aria-label={t('back')}
          onClick={backToPresets}
        />
        <h2 id={ids.customHeading} className="text-sm font-medium">
          {t('custom')}
        </h2>
      </div>
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
        trigger={trigger}
      >
        {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- keydown boundary for the whole popover, not a control */}
        <div className="flex flex-col" onKeyDown={handleKeyDown}>
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
          {(session.view === 'custom' || dirty) && (
            <div className="border-border flex justify-end gap-2 border-t p-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={close}
              >
                {tCommon('actions.cancel')}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={save}
                aria-keyshortcuts="Control+Enter Meta+Enter"
              >
                {tCommon('actions.save')}
              </Button>
            </div>
          )}
        </div>
      </Popover>
      {descriptionNode}
    </>
  );
}
