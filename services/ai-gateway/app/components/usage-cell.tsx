import { ProgressBar } from '@tale/ui/progress-bar';
import { Text } from '@tale/ui/text';
import { Fragment } from 'react';

import type { UsageWindow } from '@/app/lib/api';
import { spentPercent, usageTint } from '@/app/lib/usage-tint';
import {
  readableWindows,
  windowKey,
  windowName,
} from '@/app/lib/usage-windows';
import { useT } from '@/lib/i18n/client';

/**
 * How much of each of an account's rate-limit windows is spent.
 *
 * `ProgressBar` keeps its label for the accessible name only, so the visible
 * one is a sibling column — and every track here is a fixed length (the
 * bar's 6.5rem plus the figure it prints), so a bar is the same length in
 * every row and at every window width. A track sized to its row's longest
 * window name, or to the column, would draw two accounts at the same
 * percentage differently.
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
    <div className="grid grid-cols-[4rem_auto] items-center justify-start gap-x-2 gap-y-1.5 py-1">
      {readable.map((window, index) => {
        const name = windowName(window, t);
        const percent = spentPercent(window.utilization);
        return (
          <Fragment key={windowKey(window, index)}>
            {/* A vendor's own name for a scoped cap runs past the track the
                two translated ones fit in; `title` keeps it readable. */}
            <Text className="truncate" title={name} variant="caption">
              {name}
            </Text>
            <ProgressBar
              // 9.5rem = the 6.5rem track, the gap, and the 2.5rem figure.
              className="w-38"
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
