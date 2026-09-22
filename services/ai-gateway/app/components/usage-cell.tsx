import { ProgressBar } from '@tale/ui/progress-bar';
import { Text } from '@tale/ui/text';
import { Fragment } from 'react';

import type { UsageWindow } from '@/app/lib/api';
import {
  readableWindows,
  windowKey,
  windowName,
} from '@/app/lib/usage-windows';
import { useT } from '@/lib/i18n/client';

/**
 * Where a window stops being comfortable. Below this the bar is the ordinary
 * accent; from here on it warns, and at the ceiling it reads as spent.
 */
const WARNING_PERCENT = 75;

/**
 * The tint a spent share of a plan takes.
 *
 * `ProgressBar`'s own default reads a full bar as *finished* and paints it
 * green, which is the opposite of what a quota means: a window at 100 % is an
 * account that cannot answer. Same three tokens the platform's usage meter
 * uses, same order — accent, then warning, then destructive.
 */
function usageTint(percent: number): string {
  if (percent >= 100) return 'bg-destructive';
  if (percent >= WARNING_PERCENT) return 'bg-warning';
  return 'bg-primary';
}

/**
 * How much of each of an account's rate-limit windows is spent.
 *
 * `ProgressBar` keeps its label for the accessible name only, so the visible
 * one is a sibling column — and that column's track is fixed, so a bar is the
 * same length in every row. A track that sized to its own row's longest window
 * name would draw two accounts at the same percentage differently.
 *
 * How long each window still has to run is the next column over, on the same
 * rows; the two cells share their filter and their vertical rhythm through
 * `app/lib/usage-windows.ts`.
 */
export function UsageCell({ windows }: { windows: UsageWindow[] }) {
  const { t } = useT('usage');

  const readable = readableWindows(windows);
  if (readable.length === 0) {
    return <Text variant="caption">{t('unread')}</Text>;
  }

  return (
    <div className="grid w-full grid-cols-[4rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 py-1">
      {readable.map((window, index) => {
        const name = windowName(window, t);
        const percent = Math.round(window.utilization ?? 0);
        return (
          <Fragment key={windowKey(window, index)}>
            {/* A vendor's own name for a scoped cap runs past the track the
                two translated ones fit in; `title` keeps it readable. */}
            <Text className="truncate" title={name} variant="caption">
              {name}
            </Text>
            <ProgressBar
              className="min-w-0"
              indicatorClassName={usageTint(percent)}
              label={name}
              max={100}
              tooltipContent={t('spent', { percent })}
              value={percent}
            />
          </Fragment>
        );
      })}
    </div>
  );
}
