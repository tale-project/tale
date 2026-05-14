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

interface MetadataDiffRow {
  field: 'title' | 'description' | 'category' | 'tags' | 'scope';
  before: string;
  after: string;
}

/**
 * Build a unified-style diff using `diff`'s Myers-LCS algorithm. Lines in
 * `snapshot` but not `current` are `added` (would appear on restore);
 * lines in `current` but not `snapshot` are `removed`.
 */
function buildDiffRows(current: string, snapshot: string): DiffRow[] {
  const changes = diffLines(current, snapshot);
  const rows: DiffRow[] = [];
  for (const change of changes) {
    const segments = change.value.split('\n');
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

function tagsString(tags: string[] | undefined): string {
  return tags && tags.length > 0 ? tags.join(', ') : '—';
}

function buildMetadataDiff(
  current: PromptVersionEntry,
  snapshot: PromptVersionEntry,
): MetadataDiffRow[] {
  const out: MetadataDiffRow[] = [];
  if (current.title !== snapshot.title) {
    out.push({ field: 'title', before: current.title, after: snapshot.title });
  }
  if ((current.description ?? '') !== (snapshot.description ?? '')) {
    out.push({
      field: 'description',
      before: current.description ?? '—',
      after: snapshot.description ?? '—',
    });
  }
  if ((current.category ?? '') !== (snapshot.category ?? '')) {
    out.push({
      field: 'category',
      before: current.category ?? '—',
      after: snapshot.category ?? '—',
    });
  }
  const beforeTags = tagsString(current.tags);
  const afterTags = tagsString(snapshot.tags);
  if (beforeTags !== afterTags) {
    out.push({ field: 'tags', before: beforeTags, after: afterTags });
  }
  if (current.scope !== snapshot.scope) {
    out.push({ field: 'scope', before: current.scope, after: snapshot.scope });
  }
  return out;
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
  const metadataDiff = useMemo(
    () => buildMetadataDiff(current, snapshot),
    [current, snapshot],
  );
  const hasContentChanges = rows.some((r) => r.type !== 'context');
  const hasMetadataChanges = metadataDiff.length > 0;
  const hasChanges = hasContentChanges || hasMetadataChanges;

  return (
    <div className="flex flex-col gap-3">
      <Text variant="muted" className="text-xs">
        {t('history.compareDescription', {
          date: formatDate(new Date(snapshot.publishedAt), 'long'),
        })}
      </Text>

      {hasMetadataChanges && (
        <div className="bg-background overflow-hidden rounded-md border">
          <div className="bg-muted text-muted-foreground border-b px-3 py-1.5 text-xs font-medium">
            {t('history.metadataDiffLabel')}
          </div>
          <ul className="divide-border divide-y text-xs">
            {metadataDiff.map((row) => (
              <li
                key={row.field}
                className="grid grid-cols-[120px_1fr] gap-2 px-3 py-2"
              >
                <Text variant="label" className="text-muted-foreground">
                  {t(`history.metadataField.${row.field}`)}
                </Text>
                <div className="flex flex-col gap-0.5">
                  <span className="text-destructive">
                    <span className="sr-only">{t('history.lineRemoved')} </span>
                    <span aria-hidden="true">− </span>
                    {row.before}
                  </span>
                  <span className="text-emerald-600 dark:text-emerald-400">
                    <span className="sr-only">{t('history.lineAdded')} </span>
                    <span aria-hidden="true">+ </span>
                    {row.after}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hasContentChanges && !hasMetadataChanges ? (
        <Text
          role="status"
          variant="muted"
          className="py-4 text-center text-sm"
        >
          {t('history.noDifferences')}
        </Text>
      ) : hasContentChanges ? (
        <div className="bg-background max-h-[55vh] overflow-auto rounded-md border">
          <div className="bg-muted text-muted-foreground sticky top-0 z-10 border-b px-3 py-1.5 text-xs font-medium">
            {t('history.diffLegend', {
              current: String(current.version),
              snapshot: String(snapshot.version),
            })}
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
                {row.type !== 'context' && (
                  <span className="sr-only">
                    {row.type === 'added'
                      ? t('history.lineAdded')
                      : t('history.lineRemoved')}
                  </span>
                )}
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
                  {row.value || ' '}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-1 size-4" />
          {t('history.backToList')}
        </Button>
        <Button
          type="button"
          onClick={onRestore}
          disabled={isRestoring || !hasChanges}
          title={!hasChanges ? t('history.noDifferences') : undefined}
        >
          <RotateCcw className="mr-1 size-3" />
          {t('history.restore')}
        </Button>
      </div>
    </div>
  );
}
