'use client';

import { Button } from '@tale/ui/button';
import { format, startOfDay } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { forwardRef, memo } from 'react';
import ReactDatePicker from 'react-datepicker';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { DatePickerPopperContainer } from './date-picker-popper';

import styles from './date-range-picker.module.css';

/**
 * Single-date picker — a slim sibling of {@link ./date-range-picker} built on
 * the SAME `react-datepicker` engine + shared calendar styling, so dates look
 * and behave consistently across the app (executions filter, task due date, …).
 * Value is ms-epoch at local midnight; selecting clears via the trailing ✕.
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
}

const MonthNavHeader = memo(function MonthNavHeader({
  date,
  decreaseMonth,
  increaseMonth,
  prevMonthButtonDisabled,
  nextMonthButtonDisabled,
}: {
  date: Date;
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
      <span className="text-sm font-medium">{format(date, 'MMMM yyyy')}</span>
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
  value?: string;
  onClick?: () => void;
  disabled?: boolean;
  placeholder: string;
  hasValue: boolean;
  onClear: () => void;
  className?: string;
}

const DateTrigger = forwardRef<HTMLButtonElement, TriggerProps>(
  (
    { value, onClick, disabled, placeholder, hasValue, onClear, className },
    ref,
  ) => (
    <span
      className={cn(
        'ring-border focus-within:ring-ring inline-flex items-center gap-1 rounded-md ring-1 focus-within:ring-2',
        className,
      )}
    >
      <Button
        ref={ref}
        type="button"
        variant="ghost"
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'h-9 gap-1.5 px-2 text-sm font-normal ring-0',
          className != null && 'min-w-0 flex-1 justify-start',
          !value && 'text-muted-foreground',
        )}
      >
        <CalendarDays className="text-muted-foreground size-4 shrink-0" />
        {value || placeholder}
      </Button>
      {hasValue && !disabled && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="text-muted-foreground hover:text-foreground mr-1 cursor-pointer rounded p-0.5"
        >
          <X className="size-3.5" />
        </button>
      )}
    </span>
  ),
);
DateTrigger.displayName = 'DateTrigger';

export function DatePicker({
  value,
  onChange,
  disabled,
  placeholder,
  id,
  className,
}: DatePickerProps) {
  const { t } = useT('common');
  const selected = value !== undefined ? new Date(value) : null;
  return (
    <div className={styles.wrapper}>
      <ReactDatePicker
        id={id}
        selected={selected}
        onChange={(date: Date | null) =>
          onChange(date ? startOfDay(date).getTime() : null)
        }
        dateFormat="MMM d, yyyy"
        disabled={disabled}
        placeholderText={placeholder ?? t('datePicker.placeholder')}
        customInput={
          <DateTrigger
            disabled={disabled}
            placeholder={placeholder ?? t('datePicker.placeholder')}
            hasValue={selected != null}
            onClear={() => onChange(null)}
            className={className}
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
      />
    </div>
  );
}
