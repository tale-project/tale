'use client';

import { Button } from '@tale/ui/button';
import { diffLines } from 'diff';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useMemo } from 'react';

import { Text } from '@/app/components/ui/typography/text';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { PromptVersionEntry } from '../hooks/queries';

interface PromptCompareViewProps {
  current: PromptVersionEntry;
  snapshot: PromptVersionEntry;
  onRestore: () => void;
  isRestoring: boolean;
  onBack: () => void;
}

interface DiffRow {
  type: 'added' | 'removed' | 'context';
  value: string;
}

/**
 * Build a unified-style diff using `diff`'s Myers-LCS algorithm. Lines that
 * exist in `snapshot` but not `current` are `added` (would appear on restore);
 * lines in `current` but not `snapshot` are `removed`. Operates on raw
 * unicode strings — CJK / emoji / RTL content roundtrips correctly because
 * we never split on whitespace.
 */
function buildDiffRows(current: string, snapshot: string): DiffRow[] {
  const changes = diffLines(current, snapshot);
  const rows: DiffRow[] = [];
  for (const change of changes) {
    const segments = change.value.split('\n');
    // diffLines keeps a trailing '' when a chunk ends with '\n'; drop it so
    // we don't render a phantom blank line per chunk boundary.
    if (segments.length > 0 && segments[segments.length - 1] === '') {
      segments.pop();
    }
    const type: DiffRow['type'] = change.added
      ? 'added'
      : change.removed
        ? 'removed'
        : 'context';
    for (const line of segments) {
      rows.push({ type, value: line });
    }
  }
  return rows;
}

export function PromptCompareView({
  current,
  snapshot,
  onRestore,
  isRestoring,
  onBack,
}: PromptCompareViewProps) {
  const { t } = useT('prompts');
  const { formatDate } = useFormatDate();

  const rows = useMemo(
    () => buildDiffRows(current.content, snapshot.content),
    [current.content, snapshot.content],
  );
  const hasChanges = rows.some((r) => r.type !== 'context');

  return (
    <div className="flex flex-col gap-3">
      <Text variant="muted" className="text-xs">
        {t('history.compareDescription', {
          date: formatDate(new Date(snapshot.publishedAt), 'long'),
        })}
      </Text>

      {!hasChanges ? (
        <Text variant="muted" className="py-4 text-center text-sm">
          {t('history.noDifferences')}
        </Text>
      ) : (
        <div className="bg-background max-h-[55vh] overflow-auto rounded-md border">
          <div className="bg-muted text-muted-foreground sticky top-0 z-10 grid grid-cols-2 border-b text-xs font-medium">
            <div className="px-3 py-1.5">
              {t('history.currentVersion', {
                version: String(current.version),
              })}
            </div>
            <div className="border-l px-3 py-1.5">
              {t('history.snapshotVersion', {
                version: String(snapshot.version),
              })}
            </div>
          </div>
          <div
            className="font-mono text-xs"
            role="region"
            aria-label={t('history.diffAriaLabel')}
          >
            {rows.map((row, i) => (
              <div
                // eslint-disable-next-line react/no-array-index-key -- diff rows are positional and don't have stable IDs
                key={i}
                className={cn(
                  'flex border-l-2',
                  row.type === 'added' &&
                    'border-l-green-500 bg-green-50 dark:bg-green-950/30',
                  row.type === 'removed' &&
                    'border-l-red-500 bg-red-50 dark:bg-red-950/30',
                  row.type === 'context' && 'border-l-transparent',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'text-muted-foreground inline-block w-5 shrink-0 text-center select-none',
                    row.type === 'added' &&
                      'text-green-700 dark:text-green-300',
                    row.type === 'removed' && 'text-red-700 dark:text-red-300',
                  )}
                >
                  {row.type === 'added'
                    ? '+'
                    : row.type === 'removed'
                      ? '-'
                      : ' '}
                </span>
                <span className="min-w-0 flex-1 px-2 py-0.5 break-words whitespace-pre-wrap">
                  {row.value || ' '}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-1 size-4" />
          {t('history.backToList')}
        </Button>
        <Button
          type="button"
          onClick={onRestore}
          disabled={isRestoring || !hasChanges}
        >
          <RotateCcw className="mr-1 size-3" />
          {t('history.restore')}
        </Button>
      </div>
    </div>
  );
}
