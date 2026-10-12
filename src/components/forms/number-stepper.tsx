'use client';

import { cn } from '@tale/ui/cn';
import { useT } from '@tale/ui/i18n/client';
import { Minus, Plus } from 'lucide-react';
import {
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
  useId,
  useState,
} from 'react';

import { FIELD_FOCUS_WITHIN } from './field-focus';

export interface NumberStepperProps {
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  /** Arrow keys and the − / + buttons. @default 1 */
  step?: number;
  /** Page Up / Page Down. @default 10 */
  pageStep?: number;
  /** Id of the text field — point a `<label htmlFor>` or `aria-labelledby` at it. */
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  /** Name of the − button. @default "Decrease" */
  decrementLabel?: string;
  /** Name of the + button. @default "Increase" */
  incrementLabel?: string;
  /** Enter in the field, after the typed number is clamped and committed. */
  onEnter?: () => void;
  disabled?: boolean;
  className?: string;
}

const BUTTON_CLASSES =
  'text-muted-foreground hover:bg-accent hover:text-foreground flex w-8 shrink-0 cursor-pointer items-center justify-center transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A small whole number with − and + on either side — "Every [− 2 +] weeks".
 *
 * The field is a text input with `role="spinbutton"`, not a native number
 * input: that one draws its own spinner, accepts "e", and changes the value
 * when a wheel scrolls over it. Arrow keys step, Page Up/Down take bigger
 * steps, Home/End jump to the bounds. Typing keeps digits only; a number in
 * range is committed as it is typed, anything else is clamped on blur or
 * Enter, and an emptied field returns to the last value. The buttons stay out
 * of the tab order (the arrow keys do their job) and keep focus in the field.
 */
export function NumberStepper({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  pageStep = 10,
  id: providedId,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  decrementLabel,
  incrementLabel,
  onEnter,
  disabled,
  className,
}: NumberStepperProps) {
  const { t } = useT('common');
  const generatedId = useId();
  const id = providedId ?? generatedId;
  // What the field shows while someone types a number not yet committed —
  // an empty field, or one out of range. `null` shows `value`.
  const [typed, setTyped] = useState<string | null>(null);
  // Pointer and keyboard steps start from the same number the field shows,
  // including an out-of-range draft that has not settled on blur yet.
  const current = typed !== null && typed !== '' ? Number(typed) : value;

  const commit = (next: number) => {
    setTyped(null);
    const clamped = clamp(next, min, max);
    if (clamped !== value) onValueChange(clamped);
  };

  const settle = () => {
    if (typed === null) return;
    if (typed === '') {
      setTyped(null);
      return;
    }
    commit(Number(typed));
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const digits = event.target.value.replace(/\D/g, '');
    if (digits === '') {
      setTyped('');
      return;
    }
    const next = Number(digits);
    if (next >= min && next <= max) {
      setTyped(digits === String(next) ? null : digits);
      if (next !== value) onValueChange(next);
      return;
    }
    setTyped(digits);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        commit(current + step);
        break;
      case 'ArrowDown':
        event.preventDefault();
        commit(current - step);
        break;
      case 'PageUp':
        event.preventDefault();
        commit(current + pageStep);
        break;
      case 'PageDown':
        event.preventDefault();
        commit(current - pageStep);
        break;
      case 'Home':
        event.preventDefault();
        commit(min);
        break;
      case 'End':
        event.preventDefault();
        commit(max);
        break;
      case 'Enter':
        // No implicit form submission: Enter commits, then the host decides.
        event.preventDefault();
        settle();
        onEnter?.();
        break;
    }
  };

  // Keep focus where it is: a press on − or + must not pull it off the field.
  const keepFocus = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  return (
    <span
      className={cn(
        'bg-input inline-flex h-9 shrink-0 items-stretch overflow-hidden rounded-lg border border-[color:var(--color-border-input)] transition-[border-color,box-shadow] duration-150',
        FIELD_FOCUS_WITHIN,
        disabled && 'opacity-50',
        className,
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={decrementLabel ?? t('numberStepper.decrease')}
        aria-controls={id}
        disabled={disabled || current <= min}
        onPointerDown={keepFocus}
        onClick={() => commit(current - step)}
        className={BUTTON_CLASSES}
      >
        <Minus className="size-4" aria-hidden="true" />
      </button>
      <input
        id={id}
        type="text"
        role="spinbutton"
        inputMode="numeric"
        autoComplete="off"
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        value={typed ?? String(value)}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={settle}
        className="w-10 min-w-0 bg-transparent text-center text-base tabular-nums outline-none disabled:cursor-not-allowed md:text-sm"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={incrementLabel ?? t('numberStepper.increase')}
        aria-controls={id}
        disabled={disabled || current >= max}
        onPointerDown={keepFocus}
        onClick={() => commit(current + step)}
        className={BUTTON_CLASSES}
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
    </span>
  );
}
