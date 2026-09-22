import { ProgressBar } from '@tale/ui/progress-bar';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { Fragment } from 'react';

import type { UsageWindow } from '@/app/lib/api';
import {
  readableWindows,
  windowElapsedPercent,
  windowKey,
  windowName,
} from '@/app/lib/usage-windows';
import { useMinute } from '@/app/lib/use-minute';
import { useT } from '@/lib/i18n/client';

/** Stands in for a window the vendor reported no rollover for. */
const NO_ROLLOVER = '—';

/**
 * How long each of an account's windows still has to run.
 *
 * The figure is a bare distance — "5 days", "an hour" — because the column
 * heading supplies the rest of the sentence; the exact instant is on the
 * tooltip and on `title`, the short-in-the-row / full-on-hover split every
 * platform date cell uses.
 *
 * Beside it, the same window drawn as time rather than spend: a grey bar
 * filling toward the rollover the way the usage bar fills toward the cap. Read
 * across the two, an account burning its plan faster than the clock is one
 * whose coloured bar is ahead of its grey one. Grey rather than a status
 * colour on purpose — a window running out is not a warning, it is a clock.
 */
export function ResetsCell({ windows }: { windows: UsageWindow[] }) {
  const { t } = useT('usage');
  const { formatDate, formatRelative } = useFormatDate();
  // One reading for the whole cell, so its rows cannot disagree about "now" —
  // and one that moves, so a panel left open keeps counting down.
  const now = useMinute();

  const readable = readableWindows(windows);
  if (readable.length === 0) return null;

  return (
    <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 py-1">
      {readable.map((window, index) => {
        const name = windowName(window, t);
        const elapsed = windowElapsedPercent(window, now);
        const until = window.resetsAt
          ? formatRelative(window.resetsAt, { withoutSuffix: true })
          : null;
        const exact = window.resetsAt
          ? t('resets', { when: formatDate(window.resetsAt, 'long') })
          : null;
        return (
          <Fragment key={windowKey(window, index)}>
            {/* A window with no length to measure against keeps its cell
                empty rather than drawing a fraction of nothing. */}
            {elapsed === null ? (
              <span />
            ) : (
              <ProgressBar
                className="min-w-0"
                indicatorClassName="bg-muted-foreground/70"
                label={t('untilReset', { window: name })}
                max={100}
                tooltipContent={exact}
                value={elapsed}
                valueText={null}
              />
            )}
            <Text
              className="w-24 shrink-0 truncate text-right"
              title={exact ?? undefined}
              variant="caption"
            >
              {until ?? NO_ROLLOVER}
            </Text>
          </Fragment>
        );
      })}
    </div>
  );
}
