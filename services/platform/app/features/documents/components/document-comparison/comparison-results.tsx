'use client';

import { Badge } from '@tale/ui/badge';
import { Row, Stack } from '@tale/ui/layout';
import { AlertTriangle } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { ComparisonChangeBlock } from './comparison-change-block';
import type { DocumentComparisonResult } from './comparison-types';

interface ComparisonResultsProps {
  result: DocumentComparisonResult;
}

export function ComparisonResults({ result }: ComparisonResultsProps) {
  const { t } = useT('documents');
  const { stats, changeBlocks, truncated } = result;

  return (
    <Stack>
      <Row gap={2} wrap role="group" aria-label={t('comparison.statsSummary')}>
        {stats.added > 0 && (
          <Badge variant="green" dot>
            {t('comparison.statsAdded', { count: stats.added })}
          </Badge>
        )}
        {stats.deleted > 0 && (
          <Badge variant="destructive" dot>
            {t('comparison.statsDeleted', { count: stats.deleted })}
          </Badge>
        )}
        {stats.modified > 0 && (
          <Badge variant="yellow" dot>
            {t('comparison.statsModified', { count: stats.modified })}
          </Badge>
        )}
        {stats.unchanged > 0 && (
          <Badge variant="outline" dot>
            {t('comparison.statsUnchanged', { count: stats.unchanged })}
          </Badge>
        )}
      </Row>

      {stats.highDivergence && (
        <Row
          gap={2}
          className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 dark:border-yellow-800 dark:bg-yellow-950/30"
          role="alert"
        >
          <AlertTriangle
            className="size-4 shrink-0 text-yellow-700 dark:text-yellow-400"
            aria-hidden="true"
          />
          <span className="text-sm text-yellow-800 dark:text-yellow-300">
            {t('comparison.highDivergence')}
          </span>
        </Row>
      )}

      {truncated && (
        <Row
          gap={2}
          className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-800 dark:bg-blue-950/30"
          role="status"
        >
          <span className="text-sm text-blue-800 dark:text-blue-300">
            {t('comparison.resultsTruncated')}
          </span>
        </Row>
      )}

      {changeBlocks.length === 0 && (
        <div className="text-muted-foreground py-8 text-center text-sm">
          {t('comparison.noChanges')}
        </div>
      )}

      {changeBlocks.length > 0 && (
        <Stack gap={3} role="list" aria-label={t('comparison.changesList')}>
          {changeBlocks.map((block, index) => (
            <div key={index} role="listitem">
              <ComparisonChangeBlock block={block} index={index} />
            </div>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
