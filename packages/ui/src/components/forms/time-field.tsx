'use client';

import { cn } from '@tale/ui/cn';
import { useT } from '@tale/ui/i18n/client';
import { XCircle } from 'lucide-react';
import {
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
  clampTime,
  dayPeriodLabels,
  formatHourOnly,
  formatTimeOfDay,
  type HourCycle,
  localHourCycle,
  parseTimeText,
  sameTime,
  type TimeOfDay,
  type TimeSegment,
  timeSegmentsOrder,
  timeSeparator,
} from '../../lib/time-of-day';
import { SkeletonBox } from '../feedback/skeleton';
import { Description } from './description';
import { FIELD_FOCUS_WITHIN, FIELD_INVALID_WITHIN } from './field-focus';
import { FieldShell } from './field-shell';
import { Label } from './label';

export interface TimeFieldProps {
  /** Always a time: the field has no empty state. */
  value: TimeOfDay;
  /** Called on every committed change, and only when the time differs. */
  onValueChange: (value: TimeOfDay) => void;
  /** 12 hours with a day period, or 24. @default the locale's */
  hourCycle?: HourCycle;
  /** What the arrow keys add to the minutes. @default 1 */
  minuteStep?: number;
  /** What Page Up / Page Down add. @default { hour: 6, minute: 15 } */
  pageStep?: { hour: number; minute: number };
  /** Enter in any part, after a part typed halfway is committed. */
  onEnter?: () => void;
  /** Id of the field's group. */
  id?: string;
  label?: ReactNode;
  description?: ReactNode;
  errorMessage?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  disabled?: boolean;
  /** Focusable and readable, but the arrows and typing change nothing. */
  readOnly?: boolean;
  /** `default` is a 36px field, `sm` a 32px one. @default 'default' */
  size?: 'default' | 'sm';
  className?: string;
  /** Classes for the label-and-field frame, when a label is given. */
  wrapperClassName?: string;
}

/** A part typed halfway: the digits so far, or `''` once cleared. */
interface Draft {
  segment: 'hour' | 'minute';
  text: string;
}

/** What one typed digit does to a part. */
interface Typed {
  /** The digits still waiting for the next one, or null. */
  pending: string | null;
  /** The part's new value, when the digit completed it. */
  commit: number | null;
  /** Whether focus moves on to the next part. */
  advance: boolean;
}

const DEFAULT_PAGE_STEP = { hour: 6, minute: 15 };

type Step = 'up' | 'down' | 'pageUp' | 'pageDown' | 'home' | 'end';

/** The keys that step a part, and how far. */
const STEP_KEYS: Partial<Record<string, Step>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  PageUp: 'pageUp',
  PageDown: 'pageDown',
  Home: 'home',
  End: 'end',
};

/** A 24-hour hour: 0–2 waits for a second digit, 3–9 is the hour itself. */
function typeHour24(pending: string, digit: number): Typed {
  if (pending !== '') {
    const both = Number(pending) * 10 + digit;
    if (both <= 23) return { pending: null, commit: both, advance: true };
  }
  if (digit <= 2)
    return { pending: String(digit), commit: null, advance: false };
  return { pending: null, commit: digit, advance: true };
}

/** A 12-hour hour: 1 waits for 10–12, 0 waits for 01–09, 2–9 is the hour. */
function typeHour12(pending: string, digit: number): Typed {
  if (pending === '1' && digit <= 2) {
    return { pending: null, commit: 10 + digit, advance: true };
  }
  if (pending === '0') {
    return digit === 0
      ? { pending: '0', commit: null, advance: false }
      : { pending: null, commit: digit, advance: true };
  }
  if (digit <= 1)
    return { pending: String(digit), commit: null, advance: false };
  return { pending: null, commit: digit, advance: true };
}

/** Minutes: 0–5 waits for a second digit, 6–9 is the minute itself. */
function typeMinute(pending: string, digit: number): Typed {
  if (pending !== '') {
    return {
      pending: null,
      commit: Number(pending) * 10 + digit,
      advance: true,
    };
  }
  if (digit <= 5)
    return { pending: String(digit), commit: null, advance: false };
  return { pending: null, commit: digit, advance: true };
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

const SEGMENT_CLASSES =
  'min-w-0 rounded-sm bg-transparent px-0.5 text-center tabular-nums caret-transparent outline-none selection:bg-transparent focus:bg-accent focus:text-foreground disabled:cursor-not-allowed';

/**
 * A time of day as segmented spin buttons — "[9]:[30] [PM]" in English,
 * "[09]:[30]" in German and French — with the reader's hour cycle.
 *
 * Like `NumberStepper`, it always holds a valid time: there is no empty
 * state and nothing to validate. Each part is a tab stop; the arrow keys
 * step it and wrap around, Page Up/Down take bigger steps, Home/End jump to
 * its ends, and Left/Right move between parts. Typing fills a part and moves
 * on once it is complete ("9" is 9 o'clock, "2" waits for "23"). A whole
 * time pasted anywhere in the field — "9:30 pm", "1730", "17h30" — replaces
 * it. Backspace clears a part while you retype it; leaving it empty brings
 * the time back. The wheel is ignored, so scrolling a popover never changes
 * a time.
 */
export function TimeField({
  value,
  onValueChange,
  hourCycle,
  minuteStep = 1,
  pageStep = DEFAULT_PAGE_STEP,
  onEnter,
  id: providedId,
  label,
  description,
  errorMessage,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  disabled = false,
  readOnly = false,
  size = 'default',
  className,
  wrapperClassName,
}: TimeFieldProps) {
  const { t } = useT('timeField');
  const { i18n } = useTranslation();
  const locale = i18n?.resolvedLanguage ?? i18n?.language ?? 'en';
  const cycle = hourCycle ?? localHourCycle(locale);
  const order = useMemo(
    () => timeSegmentsOrder(locale, cycle),
    [locale, cycle],
  );
  const separator = useMemo(() => timeSeparator(locale), [locale]);
  const periods = useMemo(() => dayPeriodLabels(locale), [locale]);

  const generatedId = useId();
  const id = providedId ?? generatedId;
  const ids = {
    label: `${id}-label`,
    hour: `${id}-hour`,
    description: `${id}-description`,
    error: `${id}-error`,
    spoken: `${id}-spoken`,
  };

  const time = clampTime(value);
  const pm = time.hour >= 12;

  // The draft lives in a ref as well as in state: one event can type a
  // digit, move focus and blur the part it left, and every step must see
  // the draft the step before it left.
  const draftRef = useRef<Draft | null>(null);
  const [draft, setDraftState] = useState<Draft | null>(null);
  const setDraft = (next: Draft | null) => {
    draftRef.current = next;
    setDraftState(next);
  };
  // The latest time, for the same reason: a digit can commit an hour and
  // the blur that follows must not commit it again from a stale value.
  const valueRef = useRef(time);
  useLayoutEffect(() => {
    valueRef.current = clampTime(value);
  });
  const [notice, setNotice] = useState('');

  const segmentRefs = {
    hour: useRef<HTMLInputElement>(null),
    minute: useRef<HTMLInputElement>(null),
    dayPeriod: useRef<HTMLInputElement>(null),
  };

  const emit = (next: TimeOfDay) => {
    if (sameTime(next, valueRef.current)) return;
    valueRef.current = next;
    onValueChange(next);
  };

  /** The hour a 12- or 24-hour reading means, in the current half-day. */
  const hourFrom = (reading: number, current: TimeOfDay): number =>
    cycle === 12 ? (reading % 12) + (current.hour >= 12 ? 12 : 0) : reading;

  const commitPart = (segment: 'hour' | 'minute', reading: number) => {
    const current = valueRef.current;
    emit(
      segment === 'hour'
        ? { hour: hourFrom(reading, current), minute: current.minute }
        : { hour: current.hour, minute: reading },
    );
  };

  /** Commits a part typed halfway, or brings the time back to a cleared one. */
  const settle = () => {
    const pending = draftRef.current;
    if (pending === null) return;
    setDraft(null);
    if (pending.text === '') return;
    const reading = Number(pending.text);
    if (pending.segment === 'hour' && cycle === 12 && reading === 0) return;
    commitPart(pending.segment, reading);
  };

  const focusSegment = (segment: TimeSegment | undefined) => {
    if (segment === undefined) return;
    segmentRefs[segment].current?.focus();
  };

  const neighbour = (segment: TimeSegment, delta: number) =>
    order[order.indexOf(segment) + delta];

  const typeDigit = (segment: 'hour' | 'minute', digit: number) => {
    const current = draftRef.current;
    const pending = current?.segment === segment ? current.text : '';
    let typed: Typed;
    if (segment === 'minute') typed = typeMinute(pending, digit);
    else if (cycle === 12) typed = typeHour12(pending, digit);
    else typed = typeHour24(pending, digit);
    if (typed.pending !== null) {
      setDraft({ segment, text: typed.pending });
      return;
    }
    setDraft(null);
    if (typed.commit !== null) commitPart(segment, typed.commit);
    if (typed.advance) focusSegment(neighbour(segment, 1));
  };

  const setPeriod = (afternoon: boolean) => {
    const current = valueRef.current;
    if (afternoon === current.hour >= 12) return;
    emit({ hour: wrap(current.hour + 12, 24), minute: current.minute });
  };

  /** A letter typed on the day period: the first letter of either label. */
  const typePeriodLetter = (letter: string) => {
    const lower = letter.toLocaleLowerCase(locale);
    const startsWith = (word: string) =>
      word.toLocaleLowerCase(locale).startsWith(lower);
    if (lower === 'a' || (startsWith(periods.am) && !startsWith(periods.pm))) {
      setPeriod(false);
    } else if (
      lower === 'p' ||
      (startsWith(periods.pm) && !startsWith(periods.am))
    ) {
      setPeriod(true);
    }
  };

  const step = (segment: TimeSegment, kind: Step) => {
    settle();
    const current = valueRef.current;
    if (segment === 'dayPeriod') {
      if (kind === 'home') setPeriod(false);
      else if (kind === 'end') setPeriod(true);
      else setPeriod(current.hour < 12);
      return;
    }
    if (segment === 'minute') {
      const by = {
        up: minuteStep,
        down: -minuteStep,
        pageUp: pageStep.minute,
        pageDown: -pageStep.minute,
      };
      const minute =
        kind === 'home'
          ? 0
          : kind === 'end'
            ? 59
            : wrap(current.minute + by[kind], 60);
      emit({ hour: current.hour, minute });
      return;
    }
    const by = {
      up: 1,
      down: -1,
      pageUp: pageStep.hour,
      pageDown: -pageStep.hour,
    };
    if (cycle === 24) {
      const hour =
        kind === 'home'
          ? 0
          : kind === 'end'
            ? 23
            : wrap(current.hour + by[kind], 24);
      emit({ hour, minute: current.minute });
      return;
    }
    // A 12-hour hour cycles 12, 1 … 11 within its half of the day.
    const reading = current.hour % 12;
    const next =
      kind === 'home' ? 0 : kind === 'end' ? 11 : wrap(reading + by[kind], 12);
    emit({
      hour: next + (current.hour >= 12 ? 12 : 0),
      minute: current.minute,
    });
  };

  const handleKeyDown =
    (segment: TimeSegment) => (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return;
      const { key } = event;
      if (key === 'Enter') {
        // No implicit form submission: Enter commits, then the host decides.
        event.preventDefault();
        settle();
        onEnter?.();
        return;
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        event.preventDefault();
        const target = neighbour(segment, key === 'ArrowLeft' ? -1 : 1);
        if (target !== undefined) {
          settle();
          focusSegment(target);
        }
        return;
      }
      if (key === 'Tab' || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const stepKind = STEP_KEYS[key];
      const printable = key.length === 1;
      if (
        stepKind === undefined &&
        !printable &&
        key !== 'Backspace' &&
        key !== 'Delete'
      ) {
        return;
      }
      event.preventDefault();
      if (readOnly) return;
      if (stepKind !== undefined) {
        step(segment, stepKind);
        return;
      }
      if (segment === 'dayPeriod') {
        if (printable) typePeriodLetter(key);
        return;
      }
      if (key === 'Backspace' || key === 'Delete') {
        setDraft({ segment, text: '' });
        return;
      }
      if (/^\d$/.test(key)) {
        typeDigit(segment, Number(key));
        return;
      }
      if (
        segment === 'hour' &&
        (key === ':' || key === '.' || key === ' ' || key.toLowerCase() === 'h')
      ) {
        settle();
        focusSegment('minute');
      }
    };

  // Soft keyboards that send no usable key code type straight into the
  // field; read the character they added and treat it as typed.
  const handleChange =
    (segment: TimeSegment) => (event: ChangeEvent<HTMLInputElement>) => {
      if (readOnly) return;
      const added = event.target.value.slice(-1);
      if (segment === 'dayPeriod') {
        if (/\p{L}/u.test(added)) typePeriodLetter(added);
        return;
      }
      if (/^\d$/.test(added)) typeDigit(segment, Number(added));
    };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (readOnly || disabled) return;
    const parsed = parseTimeText(event.clipboardData.getData('text'));
    setDraft(null);
    if (parsed === null) {
      const text = t('pasteInvalid', {
        example: formatTimeOfDay({ hour: 9, minute: 30 }, locale, cycle),
      });
      // The same words again would not be announced again: clear first.
      setNotice('');
      requestAnimationFrame(() => setNotice(text));
      return;
    }
    setNotice('');
    emit(parsed);
  };

  // A press on the field's padding or separator lands on the nearest part.
  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement || disabled) return;
    event.preventDefault();
    let nearest: HTMLInputElement | null = null;
    let distance = Infinity;
    for (const segment of order) {
      const element = segmentRefs[segment].current;
      if (element === null) continue;
      const box = element.getBoundingClientRect();
      const gap = Math.abs(event.clientX - (box.left + box.right) / 2);
      if (gap < distance) {
        distance = gap;
        nearest = element;
      }
    }
    nearest?.focus();
  };

  // The day period flips on a tap once it has focus, so a touch screen can
  // change it without a keyboard.
  const periodFocusedOnPress = useRef(false);

  const invalid = Boolean(errorMessage) || ariaInvalid === true;
  const segmentHeight = size === 'sm' ? 'h-6' : 'h-7';
  const hourText = (() => {
    if (draft?.segment === 'hour') {
      if (draft.text === '') return '––';
      return cycle === 24 ? draft.text.padStart(2, '0') : draft.text;
    }
    return cycle === 24
      ? String(time.hour).padStart(2, '0')
      : String(time.hour % 12 || 12);
  })();
  const minuteText =
    draft?.segment === 'minute'
      ? draft.text === ''
        ? '––'
        : draft.text.padStart(2, '0')
      : String(time.minute).padStart(2, '0');
  const cleared = (segment: 'hour' | 'minute') =>
    draft?.segment === segment && draft.text === '';

  const common = (segment: TimeSegment) => ({
    ref: segmentRefs[segment],
    type: 'text' as const,
    autoComplete: 'off',
    spellCheck: false,
    disabled,
    readOnly,
    'aria-invalid': invalid || undefined,
    onKeyDown: handleKeyDown(segment),
    onChange: handleChange(segment),
    onBlur: settle,
    onFocus: (event: { currentTarget: HTMLInputElement }) => {
      event.currentTarget.select();
      event.currentTarget.scrollIntoView?.({ block: 'nearest' });
    },
  });

  const segments: Record<TimeSegment, ReactNode> = {
    hour: (
      <input
        key="hour"
        {...common('hour')}
        role="spinbutton"
        id={ids.hour}
        inputMode="numeric"
        aria-label={t('hours')}
        aria-valuenow={cycle === 24 ? time.hour : time.hour % 12 || 12}
        aria-valuemin={cycle === 24 ? 0 : 1}
        aria-valuemax={cycle === 24 ? 23 : 12}
        aria-valuetext={
          cleared('hour')
            ? t('empty')
            : formatHourOnly(time.hour, locale, cycle)
        }
        value={hourText}
        className={cn(
          SEGMENT_CLASSES,
          segmentHeight,
          'w-7 md:w-6',
          cycle === 12 && 'text-right',
          cleared('hour') && 'text-muted-foreground',
        )}
      />
    ),
    minute: (
      <input
        key="minute"
        {...common('minute')}
        role="spinbutton"
        inputMode="numeric"
        aria-label={t('minutes')}
        aria-valuenow={time.minute}
        aria-valuemin={0}
        aria-valuemax={59}
        aria-valuetext={
          cleared('minute')
            ? t('empty')
            : t('minuteValue', { minute: time.minute })
        }
        value={minuteText}
        className={cn(
          SEGMENT_CLASSES,
          segmentHeight,
          'w-7 md:w-6',
          cleared('minute') && 'text-muted-foreground',
        )}
      />
    ),
    dayPeriod: (
      <input
        key="dayPeriod"
        {...common('dayPeriod')}
        role="spinbutton"
        inputMode="none"
        size={Math.max(periods.am.length, periods.pm.length)}
        aria-label={t('dayPeriod')}
        aria-valuenow={pm ? 1 : 0}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuetext={pm ? periods.pm : periods.am}
        value={pm ? periods.pm : periods.am}
        onPointerDown={(event) => {
          periodFocusedOnPress.current =
            document.activeElement === event.currentTarget;
        }}
        onClick={() => {
          if (periodFocusedOnPress.current && !readOnly) setPeriod(!pm);
          periodFocusedOnPress.current = false;
        }}
        className={cn(SEGMENT_CLASSES, segmentHeight, 'ml-1 w-auto min-w-8')}
      />
    ),
  };

  const parts: ReactNode[] = [];
  order.forEach((segment, index) => {
    const previous = order[index - 1];
    if (segment === 'minute' && previous === 'hour') {
      parts.push(
        <span
          key="separator"
          aria-hidden="true"
          className="text-muted-foreground"
        >
          {separator}
        </span>,
      );
    }
    parts.push(segments[segment]);
  });

  const describedBy = [
    description !== undefined && ids.description,
    errorMessage !== undefined && ids.error,
    ariaDescribedBy,
    ids.spoken,
  ]
    .filter(Boolean)
    .join(' ');
  const labelledBy =
    ariaLabelledBy ?? (label !== undefined ? ids.label : undefined);

  const group = (
    <SkeletonBox asChild>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the group forwards a press on its padding to a part and takes a pasted time; each part is the control */}
      <div
        id={id}
        role="group"
        aria-label={labelledBy === undefined ? ariaLabel : undefined}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-disabled={disabled || undefined}
        onPaste={handlePaste}
        onMouseDown={handleMouseDown}
        className={cn(
          'bg-input inline-flex w-fit shrink-0 items-center rounded-lg border border-[color:var(--color-border-input)] px-2 text-base tabular-nums transition-[border-color,box-shadow] duration-150 md:text-sm',
          size === 'sm' ? 'h-8' : 'h-9',
          FIELD_FOCUS_WITHIN,
          invalid && FIELD_INVALID_WITHIN,
          disabled && 'cursor-not-allowed opacity-50',
          className,
        )}
      >
        {parts}
        <span id={ids.spoken} hidden>
          {formatTimeOfDay(time, locale, cycle)}
        </span>
        <span role="status" className="sr-only">
          {notice}
        </span>
      </div>
    </SkeletonBox>
  );

  if (
    label === undefined &&
    description === undefined &&
    errorMessage === undefined
  ) {
    return group;
  }

  return (
    <FieldShell
      {...(label !== undefined
        ? {
            label: (
              <Label
                id={ids.label}
                htmlFor={ids.hour}
                error={Boolean(errorMessage)}
              >
                {label}
              </Label>
            ),
          }
        : {})}
      {...(description !== undefined
        ? {
            description: (
              <Description id={ids.description}>{description}</Description>
            ),
          }
        : {})}
      {...(errorMessage !== undefined
        ? {
            error: (
              <p
                id={ids.error}
                role="alert"
                aria-live="polite"
                className="text-destructive flex items-center gap-1.5 text-sm"
              >
                <XCircle className="size-4" aria-hidden="true" />
                {errorMessage}
              </p>
            ),
          }
        : {})}
      {...(wrapperClassName !== undefined
        ? { className: wrapperClassName }
        : {})}
    >
      {group}
    </FieldShell>
  );
}
