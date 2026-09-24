import { cn } from '@tale/ui/cn';
import { ProgressBar } from '@tale/ui/progress-bar';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { TimerReset } from 'lucide-react';
import { Fragment } from 'react';

import type { UsageWindow } from '@/app/lib/api';
import {
  readableWindows,
  resetsSoon,
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
 * Beside it, the same window drawn as time rather than spend: a short grey
 * bar filling toward the rollover the way the usage bar fills toward the cap.
 * It is a glance, not a measurement — the distance beside it is the figure —
 * so it is a fraction of the usage bar's length. Grey on purpose: a window
 * running out is not a warning, it is a clock.
 *
 * The one reset that does get colour is one within the hour: a spent window
 * coming back in twenty minutes is an account about to be usable again. Its
 * bar and distance turn to the success tint, the distance is set in medium
 * weight, and a timer glyph leads it — so the cue does not rest on colour.
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
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 py-1">
      {readable.map((window, index) => {
        const name = windowName(window, t);
        const elapsed = windowElapsedPercent(window, now);
        const soon = resetsSoon(window, now);
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
                className="w-10"
                indicatorClassName={
                  soon ? 'bg-success' : 'bg-muted-foreground/70'
                }
                label={t('untilReset', { window: name })}
                max={100}
                tooltipContent={exact}
                value={elapsed}
                valueText={null}
              />
            )}
            <Text
              className={cn(
                'flex min-w-0 items-center gap-1',
                soon && 'text-success font-medium',
              )}
              title={exact ?? undefined}
              variant="caption"
            >
              {soon ? (
                <TimerReset aria-hidden className="size-3 shrink-0" />
              ) : null}
              <span className="truncate">{until ?? NO_ROLLOVER}</span>
            </Text>
          </Fragment>
        );
      })}
    </div>
  );
}
