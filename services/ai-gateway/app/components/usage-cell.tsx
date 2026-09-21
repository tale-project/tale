import { ProgressBar } from '@tale/ui/progress-bar';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';

import type { UsageWindow } from '@/app/lib/api';
import { useT } from '@/lib/i18n/client';

/**
 * An account's rate-limit windows as bars.
 *
 * The two shared windows are translated (`Session`, `Weekly`); a `scoped`
 * window carries the vendor's own name for what it caps — a model, a metered
 * limit — and is shown verbatim, because inventing our own word for someone
 * else's limit would be a guess. `ProgressBar` keeps its label for the
 * accessible name only, so the visible one is a sibling column.
 */
export function UsageCell({ windows }: { windows: UsageWindow[] }) {
  const { t } = useT('usage');
  const { formatRelative } = useFormatDate();

  const readable = windows.filter((window) => window.utilization !== null);
  if (readable.length === 0) {
    return <Text variant="caption">{t('unread')}</Text>;
  }

  return (
    <div className="flex w-full flex-col gap-1.5 py-1">
      {readable.map((window, index) => {
        const name =
          window.kind === 'scoped'
            ? (window.label ?? '')
            : t(window.kind === 'session' ? 'session' : 'weekly');
        const percent = Math.round(window.utilization ?? 0);
        const resets = window.resetsAt
          ? t('resets', { when: formatRelative(window.resetsAt) })
          : null;
        return (
          <div
            className="flex items-center gap-2"
            // Two scoped windows share a name only if the vendor repeats
            // itself; the index keeps the list keyed either way.
            key={`${window.kind}-${window.label ?? index}`}
          >
            <Text className="w-16 shrink-0 truncate" variant="caption">
              {name}
            </Text>
            <ProgressBar
              className="min-w-0 flex-1"
              label={name}
              max={100}
              tooltipContent={
                <span className="flex flex-col gap-0.5">
                  <span>{t('spent', { percent })}</span>
                  {resets ? <span>{resets}</span> : null}
                </span>
              }
              value={percent}
            />
          </div>
        );
      })}
    </div>
  );
}
