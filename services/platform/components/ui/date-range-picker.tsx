'use client';

import { HTMLAttributes, useState, forwardRef, memo, useCallback } from 'react';
import ReactDatePicker from 'react-datepicker';
import {
  CalendarDays as CalendarIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import {
  format,
  isSameDay,
  startOfDay,
  subDays,
  subMonths,
  startOfMonth,
  startOfQuarter,
  startOfYear,
} from 'date-fns';
import { DateRange } from 'react-day-picker';

import { cn } from '@/lib/utils/cn';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useT } from '@/lib/i18n';
import styles from './date-range-picker.module.css';

type DatePreset =
  | 'today'
  | 'last14Days'
  | 'last30Days'
  | 'last3Months'
  | 'last12Months'
  | 'monthToDate'
  | 'quarterToDate'
  | 'yearToDate'
  | 'allTime';

const getPresetDateRange = (preset: DatePreset): DateRange => {
  const today = startOfDay(new Date());

  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'last14Days':
      return { from: subDays(today, 13), to: today };
    case 'last30Days':
      return { from: subDays(today, 29), to: today };
    case 'last3Months':
      return { from: subMonths(today, 3), to: today };
    case 'last12Months':
      return { from: subMonths(today, 12), to: today };
    case 'monthToDate':
      return { from: startOfMonth(today), to: today };
    case 'quarterToDate':
      return { from: startOfQuarter(today), to: today };
    case 'yearToDate':
      return { from: startOfYear(today), to: today };
    case 'allTime':
      return { from: new Date(0), to: today };
  }
};

const ALL_PRESETS: DatePreset[] = [
  'today',
  'last14Days',
  'last30Days',
  'last3Months',
  'last12Months',
  'monthToDate',
  'quarterToDate',
  'yearToDate',
  'allTime',
];

const detectPresetFromRange = (
  start: Date | null,
  end: Date | null,
): DatePreset | null => {
  if (!start || !end) return null;

  const startNormalized = startOfDay(start);
  const endNormalized = startOfDay(end);

  for (const preset of ALL_PRESETS) {
    const range = getPresetDateRange(preset);
    if (
      range.from &&
      range.to &&
      isSameDay(startNormalized, range.from) &&
      isSameDay(endNormalized, range.to)
    ) {
      return preset;
    }
  }

  return null;
};

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

const DateInputHeader = memo(function DateInputHeader({
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
        variant="outline"
        size="sm"
        disabled={prevMonthButtonDisabled}
        onClick={decreaseMonth}
        className="size-6 p-0 hover:bg-accent"
      >
        <ChevronLeft className="size-3.5 text-foreground" />
      </Button>
      <p className="text-sm text-foreground">{format(date, 'MMMM yyyy')}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={nextMonthButtonDisabled}
        onClick={increaseMonth}
        className="size-6 p-0 hover:bg-accent"
      >
        <ChevronRight className="size-3.5 text-foreground" />
      </Button>
    </div>
  );
});

interface CustomInputProps {
  value?: string;
  onClick?: () => void;
  isLoading?: boolean;
  placeholder?: string;
  presetLabel?: string;
  presetOptions: { key: DatePreset; label: string }[];
  onPresetSelect: (preset: DatePreset) => void;
}

const CustomInput = forwardRef<HTMLButtonElement, CustomInputProps>(
  (
    {
      value,
      onClick,
      isLoading,
      placeholder,
      presetLabel,
      presetOptions,
      onPresetSelect,
    },
    ref,
  ) => (
    <div className="flex ring-1 ring-border rounded-lg divide-x">
      <Button
        ref={ref}
        type="button"
        variant="outline"
        disabled={isLoading}
        onClick={onClick}
        className={cn(
          'w-auto justify-start text-sm text-left font-normal space-x-2 px-2.5 rounded-r-none border-r-0 min-w-[15.75rem] ring-0',
          !value && 'text-muted-foreground',
          isLoading && 'opacity-50 cursor-not-allowed',
        )}
      >
        <CalendarIcon
          className={cn(
            'size-4 text-muted-foreground shrink-0',
            isLoading && 'hidden',
          )}
        />
        {isLoading && (
          <Loader2 className="size-4 mr-2 text-foreground animate-spin" />
        )}

        {(value || placeholder) && (
          <span className="text-sm text-muted-foreground font-normal">
            {value || placeholder}
          </span>
        )}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={isLoading}
            className="rounded-l-none px-2.5 gap-1.5 ring-0 w-[8.25rem] justify-between"
          >
            <span className="text-sm text-muted-foreground font-normal">
              {presetLabel}
            </span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-0">
          {presetOptions.map((option) => (
            <DropdownMenuItem
              key={option.key}
              onClick={() => onPresetSelect(option.key)}
              className="text-xs py-2"
            >
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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

  const [startDate, setStartDate] = useState<Date | null>(() =>
    defaultDate?.from ? startOfDay(defaultDate.from) : null,
  );
  const [endDate, setEndDate] = useState<Date | null>(() =>
    defaultDate?.to ? startOfDay(defaultDate.to) : null,
  );

  const presetOptions: { key: DatePreset; label: string }[] = [
    { key: 'today', label: t('datePicker.presets.today') },
    { key: 'last14Days', label: t('datePicker.presets.last14Days') },
    { key: 'last30Days', label: t('datePicker.presets.last30Days') },
    { key: 'last3Months', label: t('datePicker.presets.last3Months') },
    { key: 'last12Months', label: t('datePicker.presets.last12Months') },
    { key: 'monthToDate', label: t('datePicker.presets.monthToDate') },
    { key: 'quarterToDate', label: t('datePicker.presets.quarterToDate') },
    { key: 'yearToDate', label: t('datePicker.presets.yearToDate') },
    { key: 'allTime', label: t('datePicker.presets.allTime') },
  ];

  const detectedPreset = detectPresetFromRange(startDate, endDate);

  const presetLabel = detectedPreset
    ? (presetOptions.find((o) => o.key === detectedPreset)?.label ??
      t('datePicker.presets.custom'))
    : t('datePicker.presets.custom');

  const handleDateChange = useCallback(
    (dates: [Date | null, Date | null]) => {
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
    },
    [onChange],
  );

  const handlePresetSelect = useCallback(
    (preset: DatePreset) => {
      const range = getPresetDateRange(preset);
      setStartDate(range.from ?? null);
      setEndDate(range.to ?? null);
      onChange(range);
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    setStartDate(null);
    setEndDate(null);
    onChange(undefined);
  }, [onChange]);

  return (
    <div className={cn(styles.wrapper, className)}>
      <ReactDatePicker
        selectsRange
        startDate={startDate}
        endDate={endDate}
        onChange={handleDateChange}
        dateFormat="dd / MM / yyyy"
        disabled={isLoading}
        customInput={
          <CustomInput
            isLoading={isLoading}
            placeholder={t('upload.pickADate')}
            presetLabel={presetLabel}
            presetOptions={presetOptions}
            onPresetSelect={handlePresetSelect}
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
          <div className="justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="text-xs px-2 block ml-auto relative top-1 h-min py-1"
            >
              {t('actions.reset')}
            </Button>
          </div>
        )}
      </ReactDatePicker>
    </div>
  );
}
