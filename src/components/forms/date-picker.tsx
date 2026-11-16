'use client';

import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { useT } from '@tale/ui/i18n/client';
import { IconButton } from '@tale/ui/icon-button';
import { useDateFnsLocale } from '@tale/ui/use-date-fns-locale';
import { format, type Locale, startOfDay } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';

import 'react-datepicker/dist/react-datepicker.css';

import { forwardRef, memo, useCallback, useRef } from 'react';
import ReactDatePicker from 'react-datepicker';

import {
  DatePickerCalendarContainer,
  DatePickerPopperContainer,
} from './date-picker-popper';

import styles from './date-range-picker.module.css';

/**
 * Single-date picker — a slim sibling of {@link ./date-range-picker} built on
 * the SAME `react-datepicker` engine + shared calendar styling, so dates look
 * and behave consistently across the app (executions filter, task due date, …).
 * Value is ms-epoch at local midnight. The date, the month names, the weekday
 * names and the first day of the week follow the UI language; a set date is
 * cleared with the trailing ✕, its own button beside the trigger.
 */
export interface DatePickerProps {
  /** Selected date as ms since epoch (local midnight), or undefined for none. */
  value?: number;
  /** Fires with the new ms-epoch, or `null` when cleared. */
  onChange: (value: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  className?: string;
  /**
   * `default` is a bordered field for forms and filter bars. `ghost` drops the
   * border and fits the dense `h-7` row of a property list (a task's details),
   * where the date sits among other borderless value controls and a bordered
   * box would read as the one field still waiting to be filled in.
   */
  variant?: 'default' | 'ghost';
  /** The earliest day that can be picked (ms epoch); days before it are
   * disabled in the calendar. */
  minDate?: number;
  /** The latest day that can be picked (ms epoch); days after it are
   * disabled in the calendar. */
  maxDate?: number;
  /**
   * Names the trigger: a visible label's id. Include the trigger's own `id`
   * after it (`"expiry-label expiry"`) so the name keeps the chosen date —
   * a label alone would replace the date the trigger reads out. Leave
   * `htmlFor` off that label: a native label takes over the self-reference
   * and drops the date again.
   */
  'aria-labelledby'?: string;
  /** Ids of the hint or error text that describes the field. */
  'aria-describedby'?: string;
}

/**
 * The chosen date in the locale's own medium form: "Sep 29, 2026",
 * "29. Sep. 2026", "29 sept. 2026".
 */
const DISPLAY_FORMAT = 'PP';

const MonthNavHeader = memo(function MonthNavHeader({
  date,
  locale,
  decreaseMonth,
  increaseMonth,
  prevMonthButtonDisabled,
  nextMonthButtonDisabled,
}: {
  date: Date;
  locale: Locale;
  decreaseMonth: () => void;
  increaseMonth: () => void;
  prevMonthButtonDisabled: boolean;
  nextMonthButtonDisabled: boolean;
}) {
  const { t } = useT('common');
  return (
    <div className="mb-2 flex items-center justify-between px-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={prevMonthButtonDisabled}
        aria-label={t('datePicker.previousMonth')}
        onClick={decreaseMonth}
        className="hover:bg-accent size-6 p-0"
      >
        <ChevronLeft className="text-foreground size-3.5" aria-hidden="true" />
      </Button>
      <span className="text-sm font-medium">
        {format(date, 'LLLL yyyy', { locale })}
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={nextMonthButtonDisabled}
        aria-label={t('datePicker.nextMonth')}
        onClick={increaseMonth}
        className="hover:bg-accent size-6 p-0"
      >
        <ChevronRight className="text-foreground size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
});

interface TriggerProps {
  /** Handed down by react-datepicker from the picker's own props. */
  id?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  value?: string;
  onClick?: () => void;
  disabled?: boolean;
  placeholder: string;
  hasValue: boolean;
  onClear: () => void;
  clearLabel: string;
  className?: string;
  variant: 'default' | 'ghost';
}

/**
 * The field: the trigger that opens the calendar and, while a date is set, a
 * clear button beside it — two sibling buttons, never one inside the other.
 * The field's ring follows the trigger's focus; the clear button draws its
 * own, so the ring always says which of the two has focus.
 */
const DateTrigger = forwardRef<HTMLButtonElement, TriggerProps>(
  (
    {
      id,
      'aria-labelledby': ariaLabelledBy,
      'aria-describedby': ariaDescribedBy,
      value,
      onClick,
      disabled,
      placeholder,
      hasValue,
      onClear,
      clearLabel,
      className,
      variant,
    },
    ref,
  ) => {
    // react-datepicker hands the trigger its own ref; the clear button needs
    // the same node to put focus back where the keyboard user left off.
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const setTriggerRef = useCallback(
      (node: HTMLButtonElement | null) => {
        triggerRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-md',
          'has-[[data-date-picker-trigger]:focus]:ring-ring has-[[data-date-picker-trigger]:focus]:ring-2',
          variant === 'default' && 'ring-border ring-1',
          className,
        )}
      >
        <Button
          ref={setTriggerRef}
          id={id}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          type="button"
          variant="ghost"
          disabled={disabled}
          onClick={onClick}
          data-date-picker-trigger=""
          className={cn(
            'gap-1.5 text-sm font-normal ring-0',
            variant === 'ghost' ? 'h-7 px-1.5' : 'h-9 px-2',
            className != null && 'min-w-0 flex-1 justify-start',
            !value && 'text-muted-foreground',
          )}
        >
          <CalendarDays className="text-muted-foreground size-4 shrink-0" />
          {value || placeholder}
        </Button>
        {hasValue && !disabled && (
          <IconButton
            type="button"
            icon={X}
            size="sm"
            aria-label={clearLabel}
            iconClassName="size-3.5"
            onClick={(event) => {
              event.stopPropagation();
              onClear();
              // The clear button leaves with the value; without this, focus
              // would fall to the page body.
              triggerRef.current?.focus();
            }}
            className="mr-1 size-6 shrink-0 rounded-md"
          />
        )}
      </span>
    );
  },
);
DateTrigger.displayName = 'DateTrigger';

export function DatePicker({
  value,
  onChange,
  disabled,
  placeholder,
  id,
  className,
  variant = 'default',
  minDate,
  maxDate,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: DatePickerProps) {
  const { t } = useT('common');
  const locale = useDateFnsLocale();
  const selected = value !== undefined ? new Date(value) : null;
  return (
    <div className={cn(styles.wrapper, 'w-full')}>
      <ReactDatePicker
        id={id}
        selected={selected}
        onChange={(date: Date | null) =>
          onChange(date ? startOfDay(date).getTime() : null)
        }
        dateFormat={DISPLAY_FORMAT}
        locale={locale}
        minDate={minDate !== undefined ? new Date(minDate) : undefined}
        maxDate={maxDate !== undefined ? new Date(maxDate) : undefined}
        ariaLabelledBy={ariaLabelledBy}
        ariaDescribedBy={ariaDescribedBy}
        chooseDayAriaLabelPrefix={t('datePicker.chooseDay')}
        disabledDayAriaLabelPrefix={t('datePicker.unavailableDay')}
        monthAriaLabelPrefix={t('datePicker.month')}
        disabled={disabled}
        placeholderText={placeholder ?? t('datePicker.placeholder')}
        customInput={
          <DateTrigger
            disabled={disabled}
            placeholder={placeholder ?? t('datePicker.placeholder')}
            hasValue={selected != null}
            onClear={() => onChange(null)}
            clearLabel={t('datePicker.clear')}
            className={cn('w-full', className)}
            variant={variant}
          />
        }
        renderCustomHeader={({
          date,
          decreaseMonth,
          increaseMonth,
          prevMonthButtonDisabled,
          nextMonthButtonDisabled,
        }) => (
          <MonthNavHeader
            date={date}
            locale={locale}
            decreaseMonth={decreaseMonth}
            increaseMonth={increaseMonth}
            prevMonthButtonDisabled={prevMonthButtonDisabled}
            nextMonthButtonDisabled={nextMonthButtonDisabled}
          />
        )}
        calendarClassName="date-range-picker-calendar"
        wrapperClassName="w-full"
        popperClassName="date-range-picker-popper"
        popperPlacement="bottom-start"
        popperContainer={DatePickerPopperContainer}
        calendarContainer={DatePickerCalendarContainer}
      />
    </div>
  );
}
