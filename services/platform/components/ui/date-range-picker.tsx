'use client';

import { HTMLAttributes, useEffect, useState, forwardRef, memo } from 'react';
import ReactDatePicker from 'react-datepicker';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { format, startOfDay } from 'date-fns';
import { DateRange } from 'react-day-picker';

import { cn } from '@/lib/utils/cn';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import styles from './date-range-picker.module.css';

export interface DatePickerWithRangeProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'onChange'
> {
  onChange: (date: DateRange | undefined) => void;
  defaultDate?: DateRange;
  isLoading?: boolean;
}

interface DateInputHeaderProps {
  date: Date;
  decreaseMonth: () => void;
  increaseMonth: () => void;
  prevMonthButtonDisabled: boolean;
  nextMonthButtonDisabled: boolean;
}

function DateInputHeader({
  date,
  decreaseMonth,
  increaseMonth,
  prevMonthButtonDisabled,
  nextMonthButtonDisabled,
}: DateInputHeaderProps) {
  return (
    <div className="flex items-center justify-between px-1 mb-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={prevMonthButtonDisabled}
        onClick={decreaseMonth}
        className="h-6 w-6 p-0 hover:bg-accent"
      >
        <ChevronLeft className="size-3.5 text-foreground" />
      </Button>
      <p className="text-sm font-semibold text-foreground">
        {format(date, 'MMMM yyyy')}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={nextMonthButtonDisabled}
        onClick={increaseMonth}
        className="h-6 w-6 p-0 hover:bg-accent"
      >
        <ChevronRight className="size-3.5 text-foreground" />
      </Button>
    </div>
  );
}

interface CustomInputProps {
  value?: string;
  onClick?: () => void;
  isLoading?: boolean;
  placeholder?: string;
}

const CustomInput = forwardRef<HTMLButtonElement, CustomInputProps>(
  ({ value, onClick, isLoading, placeholder }, ref) => (
    <Button
      ref={ref}
      type="button"
      variant="outline"
      disabled={isLoading}
      onClick={onClick}
      className={cn(
        'w-auto justify-start text-sm text-left font-normal space-x-2 px-2.5',
        !value && 'text-muted-foreground',
        isLoading && 'opacity-50 cursor-not-allowed',
      )}
    >
      <CalendarIcon
        className={cn('size-4 text-foreground shrink-0', isLoading && 'hidden')}
      />
      {isLoading && (
        <Loader2 className="size-4 mr-2 text-foreground animate-spin" />
      )}

      {(value || placeholder) && (
        <span className="text-sm text-muted-foreground">
          {value || placeholder}
        </span>
      )}
    </Button>
  ),
);
CustomInput.displayName = 'CustomInput';

export function DatePickerWithRange({
  className,
  onChange,
  defaultDate,
  isLoading = false,
}: DatePickerWithRangeProps) {
  const { t } = useT('common');

  const [startDate, setStartDate] = useState<Date | null>(
    defaultDate?.from ? startOfDay(defaultDate.from) : null,
  );
  const [endDate, setEndDate] = useState<Date | null>(
    defaultDate?.to ? startOfDay(defaultDate.to) : null,
  );

  useEffect(() => {
    if (startDate) {
      return;
    }

    setStartDate(defaultDate?.from ? startOfDay(defaultDate.from) : null);
    setEndDate(defaultDate?.to ? startOfDay(defaultDate.to) : null);
  }, [defaultDate?.from, defaultDate?.to, startDate]);

  const handleDateChange = (dates: [Date | null, Date | null]) => {
    const [start, end] = dates;

    // Update local state immediately for optimistic UI
    setStartDate(start);
    setEndDate(end);

    // Only call onChange when both dates are selected or both are cleared
    if (start && end) {
      onChange({ from: start, to: end });
    } else if (!start && !end) {
      onChange(undefined);
    }
  };

  const handleClear = () => {
    setStartDate(null);
    setEndDate(null);
    onChange(undefined);
  };

  return (
    <div className={cn(styles.wrapper, className)}>
      <ReactDatePicker
        selectsRange
        startDate={startDate}
        endDate={endDate}
        onChange={handleDateChange}
        dateFormat="MMM d, yyyy"
        disabled={isLoading}
        customInput={
          <CustomInput
            isLoading={isLoading}
            placeholder={t('upload.pickADate')}
          />
        }
        renderCustomHeader={({
          date,
          decreaseMonth,
          increaseMonth,
          prevMonthButtonDisabled,
          nextMonthButtonDisabled,
        }) => (
          <DateInputHeader
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
      >
        {(startDate || endDate) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="text-xs px-2 block ml-auto"
          >
            {t('actions.clearAll')}
          </Button>
        )}
      </ReactDatePicker>
    </div>
  );
}
