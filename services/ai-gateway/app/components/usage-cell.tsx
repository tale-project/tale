import { ProgressBar } from '@tale/ui/progress-bar';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { Fragment } from 'react';

import type { UsageWindow } from '@/app/lib/api';
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
 * An account's rate-limit windows as bars, each with the moment it rolls over.
 *
 * The two shared windows are translated (`Session`, `Weekly`); a `scoped`
 * window carries the vendor's own name for what it caps — a model, a metered
 * limit — and is shown verbatim, because inventing our own word for someone
 * else's limit would be a guess. `ProgressBar` keeps its label for the
 * accessible name only, so the visible one is a sibling column.
 *
 * "When does this come back" is the question a spent plan raises, so the reset
 * is in the row rather than behind a hover. It reads relatively ("in 6 days")
 * — the form that answers that question at a glance — with the exact instant
 * on `title` and in the bar's tooltip, the same short-in-the-row /
 * full-on-hover split every platform date cell uses.
 *
 * The three parts sit in one grid. The name track is fixed so a bar is the
 * same length in every row — a bar whose track depended on its neighbours'
 * text would make two accounts at the same percentage look different — while
 * the reset track sizes to its own content, because that phrase is half again
 * as long in German as in English and cutting it off would hide the one thing
 * the column is for.
 */
export function UsageCell({ windows }: { windows: UsageWindow[] }) {
  const { t } = useT('usage');
  const { formatDate, formatRelative } = useFormatDate();

  const readable = windows.filter((window) => window.utilization !== null);
  if (readable.length === 0) {
    return <Text variant="caption">{t('unread')}</Text>;
  }

  return (
    <div className="grid w-full grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 py-1">
      {readable.map((window, index) => {
        const name =
          window.kind === 'scoped'
            ? (window.label ?? '')
            : t(window.kind === 'session' ? 'session' : 'weekly');
        const percent = Math.round(window.utilization ?? 0);
        // The same sentence at two precisions: the relative one answers
        // "when does this come back" in the row, the absolute one is what a
        // reader who needs the hour hovers for.
        const resets = window.resetsAt
          ? t('resets', { when: formatRelative(window.resetsAt) })
          : null;
        const resetsExactly = window.resetsAt
          ? t('resets', { when: formatDate(window.resetsAt, 'long') })
          : null;
        return (
          <Fragment
            // Two scoped windows share a name only if the vendor repeats
            // itself; the index keeps the list keyed either way.
            key={`${window.kind}-${window.label ?? index}`}
          >
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
              tooltipContent={
                <span className="flex flex-col gap-0.5">
                  <span>{t('spent', { percent })}</span>
                  {resetsExactly ? <span>{resetsExactly}</span> : null}
                </span>
              }
              value={percent}
            />
            {/* A window the vendor gave no rollover for still holds its cell,
                so one silent window does not shift the rows around it. */}
            <Text
              className="whitespace-nowrap"
              title={resetsExactly ?? undefined}
              variant="caption"
            >
              {resets}
            </Text>
          </Fragment>
        );
      })}
    </div>
  );
}
