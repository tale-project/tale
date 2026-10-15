'use client';

/**
 * When a message or an event happened, as a thread shows it: the clock time
 * ("14:32") under a day divider that already names the day, with the full
 * date and time on hover and in `dateTime` for assistive technology.
 */

import { useFormatDate } from '@tale/ui/use-format-date';

export interface ThreadTimeProps {
  /** Epoch milliseconds, or a Date. */
  value: number | Date;
  /**
   * `time` under a day divider; `relative` ("5 min ago") where nothing names
   * the day. @default 'time'
   */
  format?: 'time' | 'relative';
  className?: string;
}

export function ThreadTime({
  value,
  format = 'time',
  className,
}: ThreadTimeProps) {
  const { formatDate, formatRelative } = useFormatDate();
  const date = new Date(value);
  return (
    <time
      dateTime={date.toISOString()}
      title={formatDate(date, 'long')}
      className={className}
    >
      {format === 'relative' ? formatRelative(date) : formatDate(date, 'time')}
    </time>
  );
}
