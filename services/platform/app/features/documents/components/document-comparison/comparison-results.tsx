'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Row, Stack } from '@tale/ui/layout';

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
        <Alert variant="warning" description={t('comparison.highDivergence')} />
      )}

      {truncated && (
        <Alert
          variant="info"
          live="off"
          description={t('comparison.resultsTruncated')}
        />
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
