'use client';

import { Check, Copy } from 'lucide-react';
import * as React from 'react';

import { useCopyButton } from '@/app/hooks/use-copy';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { type DatePreset } from '@/lib/utils/date/format';

interface CopyableTimestampProps {
  /** The date to display and copy (Unix ms, Date, or ISO string) */
  date: number | Date | string | null | undefined;
  /** Format preset for display */
  preset?: DatePreset;
  /** Custom dayjs format string (overrides preset for display) */
  customFormat?: string;
  /** Additional className */
  className?: string;
  /** Text to show when date is null/undefined */
  emptyText?: string;
  /** Whether to align text to the right */
  alignRight?: boolean;
}

/**
 * Displays a formatted timestamp with a copy button that copies the raw
 * Unix millisecond value to the clipboard — useful for power users who need
 * the exact timestamp for debugging or querying.
 *
 * @example
 * ```tsx
 * <CopyableTimestamp date={row.original.lastModified} preset="short" alignRight />
 * ```
 */
export const CopyableTimestamp = React.memo(function CopyableTimestamp({
  date,
  preset = 'short',
  customFormat,
  className,
  emptyText = '—',
  alignRight = false,
}: CopyableTimestampProps) {
  const { formatDate, timezone, timezoneShort } = useFormatDate();
  const { t: tCommon } = useT('common');

  if (date === null || date === undefined) {
    return (
      <span
        className={cn(
          'text-sm text-muted-foreground whitespace-nowrap',
          alignRight && 'text-right block',
          className,
        )}
      >
        {emptyText}
      </span>
    );
  }

  const dateObj =
    typeof date === 'number' || typeof date === 'string'
      ? new Date(date)
      : date;

  const timestampMs = String(dateObj.valueOf());
  const showTimezone = preset === 'long' || preset === 'time';
  const baseFormatted = customFormat
    ? formatDate(dateObj, preset, { customFormat })
    : formatDate(dateObj, preset);
  const formatted = showTimezone
    ? `${baseFormatted} ${timezoneShort}`
    : baseFormatted;
  const titleText = `${formatDate(dateObj, 'long')} (${timezone})`;

  return (
    <CopyableTimestampInner
      timestampMs={timestampMs}
      formatted={formatted}
      titleText={titleText}
      alignRight={alignRight}
      className={className}
      tCommon={tCommon}
    />
  );
});

interface CopyableTimestampInnerProps {
  timestampMs: string;
  formatted: string;
  titleText: string;
  alignRight: boolean;
  className?: string;
  tCommon: (key: string) => string;
}

function CopyableTimestampInner({
  timestampMs,
  formatted,
  titleText,
  alignRight,
  className,
  tCommon,
}: CopyableTimestampInnerProps) {
  const { copied, onClick } = useCopyButton(timestampMs);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1',
        alignRight && 'justify-end w-full',
        className,
      )}
    >
      <span
        className="text-muted-foreground text-sm whitespace-nowrap"
        title={titleText}
      >
        {formatted}
      </span>
      <button
        type="button"
        className={cn(
          'shrink-0 cursor-pointer rounded p-0.5 transition-colors',
          'focus-visible:opacity-100',
          'hover:bg-muted',
        )}
        aria-label={tCommon('actions.copy')}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        {copied ? (
          <Check
            className="size-3.5 text-green-600 dark:text-green-400"
            aria-hidden="true"
          />
        ) : (
          <Copy className="text-muted-foreground size-3.5" aria-hidden="true" />
        )}
      </button>
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {copied ? tCommon('actions.copied') : ''}
      </span>
    </span>
  );
}
