'use client';

import { useMemo } from 'react';

import type { ChangeBlock } from '@/convex/agent_tools/documents/helpers/fetch_document_comparison';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface ComparisonChangeBlockProps {
  block: ChangeBlock;
  index: number;
}

export function ComparisonChangeBlock({
  block,
  index,
}: ComparisonChangeBlockProps) {
  const { t } = useT('documents');

  return (
    <div
      className="overflow-hidden rounded-lg border"
      role="region"
      aria-label={t('comparison.changeBlockLabel', {
        index: (index + 1).toString(),
      })}
    >
      {block.contextBefore && (
        <div className="bg-muted/50 text-muted-foreground px-4 py-2 text-sm">
          {block.contextBefore}
        </div>
      )}

      <div className="divide-border divide-y">
        {block.items.map((item, itemIndex) => (
          <div
            key={itemIndex}
            className={cn(
              'px-4 py-2 text-sm',
              item.type === 'added' && 'bg-green-50 dark:bg-green-950/30',
              item.type === 'deleted' && 'bg-red-50 dark:bg-red-950/30',
              item.type === 'modified' && 'bg-yellow-50 dark:bg-yellow-950/30',
              item.type === 'context' && 'bg-muted/30',
            )}
          >
            <div className="flex items-start gap-2">
              <span
                className={cn(
                  'mt-0.5 shrink-0 select-none font-mono text-xs font-semibold',
                  item.type === 'added' && 'text-green-700 dark:text-green-400',
                  item.type === 'deleted' && 'text-red-700 dark:text-red-400',
                  item.type === 'modified' &&
                    'text-yellow-700 dark:text-yellow-400',
                  item.type === 'context' && 'text-muted-foreground',
                )}
                aria-hidden="true"
              >
                {item.type === 'added' && '+'}
                {item.type === 'deleted' && '\u2212'}
                {item.type === 'modified' && '~'}
                {item.type === 'context' && ' '}
              </span>

              <div className="min-w-0 flex-1">
                {item.type === 'context' && (
                  <span className="text-muted-foreground">{item.content}</span>
                )}

                {item.type === 'added' && (
                  <span className="text-green-800 dark:text-green-300">
                    {item.comparisonContent ?? item.content}
                  </span>
                )}

                {item.type === 'deleted' && (
                  <span className="text-red-800 dark:text-red-300">
                    {item.baseContent ?? item.content}
                  </span>
                )}

                {item.type === 'modified' && (
                  <ModifiedContent
                    baseContent={item.baseContent}
                    comparisonContent={item.comparisonContent}
                    inlineDiff={item.inlineDiff}
                  />
                )}

                {item.clauseRef && (
                  <span className="text-muted-foreground ml-2 text-xs">
                    [{item.clauseRef}]
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {block.contextAfter && (
        <div className="bg-muted/50 text-muted-foreground px-4 py-2 text-sm">
          {block.contextAfter}
        </div>
      )}
    </div>
  );
}

function ModifiedContent({
  baseContent,
  comparisonContent,
  inlineDiff,
}: {
  baseContent: string | null;
  comparisonContent: string | null;
  inlineDiff?: string | null;
}) {
  const { t } = useT('documents');

  const segments = useMemo(() => {
    if (!inlineDiff) return null;
    return parseInlineDiff(inlineDiff);
  }, [inlineDiff]);

  if (segments) {
    return (
      <span>
        {segments.map((segment, i) => (
          <span
            key={i}
            className={cn(
              segment.type === 'deleted' &&
                'bg-red-200 line-through dark:bg-red-900/50',
              segment.type === 'added' && 'bg-green-200 dark:bg-green-900/50',
            )}
          >
            {segment.text}
          </span>
        ))}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {baseContent && (
        <div className="text-red-700 line-through dark:text-red-400">
          <span className="sr-only">{t('comparison.removedText')}</span>
          {baseContent}
        </div>
      )}
      {comparisonContent && (
        <div className="text-green-700 dark:text-green-400">
          <span className="sr-only">{t('comparison.addedText')}</span>
          {comparisonContent}
        </div>
      )}
    </div>
  );
}

interface DiffSegment {
  type: 'unchanged' | 'deleted' | 'added';
  text: string;
}

function parseInlineDiff(diff: string): DiffSegment[] {
  const segments: DiffSegment[] = [];
  let remaining = diff;

  while (remaining.length > 0) {
    const deletedStart = remaining.indexOf('[-');
    const addedStart = remaining.indexOf('{+');

    let nextMarker = -1;
    let markerType: 'deleted' | 'added' | null = null;

    if (deletedStart >= 0 && (addedStart < 0 || deletedStart < addedStart)) {
      nextMarker = deletedStart;
      markerType = 'deleted';
    } else if (addedStart >= 0) {
      nextMarker = addedStart;
      markerType = 'added';
    }

    if (nextMarker < 0 || !markerType) {
      if (remaining.length > 0) {
        segments.push({ type: 'unchanged', text: remaining });
      }
      break;
    }

    if (nextMarker > 0) {
      segments.push({
        type: 'unchanged',
        text: remaining.slice(0, nextMarker),
      });
    }

    const endMarker = markerType === 'deleted' ? '-]' : '+}';
    const markerLen = 2;
    const endIndex = remaining.indexOf(endMarker, nextMarker + markerLen);

    if (endIndex < 0) {
      segments.push({ type: 'unchanged', text: remaining.slice(nextMarker) });
      break;
    }

    const innerText = remaining.slice(nextMarker + markerLen, endIndex);
    segments.push({ type: markerType, text: innerText });
    remaining = remaining.slice(endIndex + markerLen);
  }

  return segments;
}
