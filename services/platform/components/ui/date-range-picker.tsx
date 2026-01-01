'use client';

import { ComponentProps, HTMLAttributes, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { formatDate } from '@/lib/utils/date/format';
import { DateRange } from 'react-day-picker';

import { cn } from '@/lib/utils/cn';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar as CalendarIcon } from 'lucide-react';
import { useT } from '@/lib/i18n';

export interface DatePickerWithRangeProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  onChange: (date: DateRange) => void;
  defaultDate?: DateRange;
  calendarProps?: ComponentProps<typeof Calendar>;
  isLoading?: boolean;
}

export function DatePickerWithRange({
  className,
  onChange,
  defaultDate,
  calendarProps,
  isLoading = false,
}: DatePickerWithRangeProps) {
  const { t } = useT('common');
  const [isOpen, setIsOpen] = useState(false);
  const [date, setDate] = useState<DateRange | undefined>(defaultDate);

  const handleDateChange = (date?: DateRange) => {
    if (!date) {
      return;
    }

    setDate(date);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && date) {
      onChange(date);
    }
    setIsOpen(open);
  };

  return (
    <div className={cn('grid gap-2', className)}>
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={'outline'}
            disabled={isLoading}
            className={cn(
              'h-[2.1rem] w-auto justify-start text-sm text-left font-normal',
              !date && 'text-muted-foreground',
              isLoading && 'opacity-50 cursor-not-allowed',
            )}
          >
            <CalendarIcon
              className={cn(
                'size-4 mr-2 text-foreground shrink-0',
                isLoading && 'hidden',
              )}
            />
            {isLoading && (
              <Loader2 className="size-4 mr-2 text-foreground animate-spin" />
            )}
            {date?.from ? (
              date.to ? (
                <>
                  {formatDate(date.from, { preset: 'medium' })} -{' '}
                  {formatDate(date.to, { preset: 'medium' })}
                </>
              ) : (
                formatDate(date.from, { preset: 'medium' })
              )
            ) : (
              <span>{t('upload.pickADate')}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto p-0"
          align="start"
          side="right"
          sideOffset={8}
        >
          <Calendar
            {...calendarProps}
            initialFocus
            mode="range"
            defaultMonth={date?.from}
            selected={date}
            numberOfMonths={2}
            onSelect={handleDateChange}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
