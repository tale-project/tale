import { cn } from '@tale/ui/cn';
import { ProgressBar } from '@tale/ui/progress-bar';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { TimerReset } from 'lucide-react';
import { Fragment } from 'react';

import type { UsageWindow } from '@/app/lib/api';
import {
  hasRolledOver,
  readableWindows,
  resetRole,
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
 * The fill of a clock bar: the success tint inside the hour of the account's
 * return, a darker grey for the clock that decides it, the ordinary grey for
 * every other.
 */
function clockTint(decisive: boolean, soon: boolean): string {
  if (soon) return 'bg-success';
  return decisive ? 'bg-foreground/70' : 'bg-muted-foreground/70';
}

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
 * The rows stay line for line with the usage column, so a clock sits beside
 * its own spend. What changes with the account is which clock is the one that
 * counts. An account whose quota is spent comes back when its LAST spent
 * window rolls over — a session that resets in five minutes beside a spent
 * week is not back in five minutes — so that window's row is the one read in
 * full strength, with a timer glyph, and the rows that only wait on it step
 * back. Inside the hour the row takes the success tint: the account is about
 * to be usable again. A window that is not holding the account back is an
 * ordinary countdown and never gets the tint, whatever its distance.
 */
export function ResetsCell({
  windows,
  limitedUntil,
}: {
  windows: UsageWindow[];
  limitedUntil: string | null;
}) {
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
        const role = resetRole(window, limitedUntil);
        const decisive = role === 'return' && window.resetsAt !== null;
        const soon = decisive && resetsSoon(window.resetsAt, now);
        const elapsed = windowElapsedPercent(window, now);
        const rolledOver = hasRolledOver(window.resetsAt, now);
        let until: string | null = null;
        if (window.resetsAt) {
          until = rolledOver
            ? t('rolledOver')
            : formatRelative(window.resetsAt, { withoutSuffix: true });
        }
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
                indicatorClassName={clockTint(decisive, soon)}
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
                decisive && 'text-foreground font-medium',
                soon && 'text-success',
              )}
              title={exact ?? undefined}
              variant="caption"
            >
              {decisive ? (
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
