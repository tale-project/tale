'use client';

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
import {
  CalendarDays as CalendarIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { HTMLAttributes, useState, forwardRef, memo, useCallback } from 'react';
import ReactDatePicker from 'react-datepicker';
import { DateRange } from 'react-day-picker';

import {
  DropdownMenu,
  type DropdownMenuItem,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import styles from './date-range-picker.module.css';

export type DatePreset =
  | 'today'
  | 'last7Days'
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
    case 'last7Days':
      return { from: subDays(today, 6), to: today };
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

const DEFAULT_PRESETS: DatePreset[] = [
  'today',
  'last7Days',
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
  activePresets: DatePreset[] = DEFAULT_PRESETS,
): DatePreset | null => {
  if (!start || !end) return null;

  const startNormalized = startOfDay(start);
  const endNormalized = startOfDay(end);

  for (const preset of activePresets) {
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
  presets?: DatePreset[];
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
    <div className="mb-2 flex items-center justify-between px-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={prevMonthButtonDisabled}
        onClick={decreaseMonth}
        className="hover:bg-accent size-6 p-0"
      >
        <ChevronLeft className="text-foreground size-3.5" />
      </Button>
      <p className="text-foreground text-sm">{format(date, 'MMMM yyyy')}</p>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={nextMonthButtonDisabled}
        onClick={increaseMonth}
        className="hover:bg-accent size-6 p-0"
      >
        <ChevronRight className="text-foreground size-3.5" />
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
    <div className="ring-border flex divide-x rounded-lg ring-1">
      <Button
        ref={ref}
        type="button"
        variant="secondary"
        disabled={isLoading}
        onClick={onClick}
        className={cn(
          'w-auto justify-start text-sm text-left font-normal space-x-2 px-2.5 rounded-r-none border-r-0 ring-0',
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
          <Loader2 className="text-foreground mr-2 size-4 animate-spin" />
        )}

        {(value || placeholder) && (
          <span className="text-muted-foreground text-sm font-normal">
            {value || placeholder}
          </span>
        )}
      </Button>
      <DropdownMenu
        trigger={
          <Button
            type="button"
            variant="secondary"
            disabled={isLoading}
            className="w-[8.25rem] justify-between gap-1.5 rounded-l-none px-2.5 ring-0"
          >
            <span className="text-muted-foreground text-sm font-normal">
              {presetLabel}
            </span>
            <ChevronDown className="text-muted-foreground size-4" />
          </Button>
        }
        items={[
          presetOptions.map<DropdownMenuItem>((option) => ({
            type: 'item',
            label: option.label,
            onClick: () => onPresetSelect(option.key),
            className: 'py-2 text-xs',
          })),
        ]}
        align="end"
        contentClassName="min-w-0"
      />
    </div>
  ),
);
CustomInput.displayName = 'CustomInput';

export function DatePickerWithRange({
  className,
  onChange,
  defaultDate,
  isLoading = false,
  presets = DEFAULT_PRESETS,
}: DatePickerWithRangeProps) {
  const { t } = useT('common');

  const [startDate, setStartDate] = useState<Date | null>(() =>
    defaultDate?.from ? startOfDay(defaultDate.from) : null,
  );
  const [endDate, setEndDate] = useState<Date | null>(() =>
    defaultDate?.to ? startOfDay(defaultDate.to) : null,
  );

  const presetOptions = presets.map((key) => ({
    key,
    label: t(`datePicker.presets.${key}`),
  }));

  const detectedPreset = detectPresetFromRange(startDate, endDate, presets);

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
              className="relative top-1 ml-auto block h-min px-2 py-1 text-xs"
            >
              {t('actions.reset')}
            </Button>
          </div>
        )}
      </ReactDatePicker>
    </div>
  );
}
