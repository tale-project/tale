'use client';

/**
 * Connected `ReviewQueue` block — binds an allowlisted approvals query and lists
 * the pending items. The successor to the old review-panel (cardinality:many):
 * generic over whatever approval rows the bound query returns.
 */
import { Badge } from '@tale/ui/badge';
import { Card } from '@tale/ui/card';
import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundQuery } from '../../hooks/use-bound-query';

export interface ReviewQueueProps {
  title?: string;
  query: { path: string; args?: unknown };
}

function label(row: Record<string, unknown>): string {
  const meta = isRecord(row.metadata) ? row.metadata : {};
  for (const v of [meta.question, meta.summary, row.resourceType, row.title]) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return 'review';
}

export function ReviewQueue({ title, query }: ReviewQueueProps) {
  const { t } = useT('apps');
  const { data, blocked } = useBoundQuery(query.path, query.args);
  const rows = (Array.isArray(data) ? data : []).filter(isRecord);

  return (
    <VStack gap={3}>
      {title && (
        <Text as="span" className="text-lg font-semibold">
          {title}
        </Text>
      )}
      {blocked ? (
        <Text variant="error">
          {t('binding.blocked', { path: query.path })}
        </Text>
      ) : rows.length === 0 ? (
        <Text variant="muted">{t('review.none')}</Text>
      ) : (
        rows.map((row, i) => (
          <Card key={i}>
            <HStack gap={3} className="items-center justify-between">
              <Text as="span">{label(row)}</Text>
              <Badge variant="yellow">{t('review.awaiting')}</Badge>
            </HStack>
          </Card>
        ))
      )}
    </VStack>
  );
}
