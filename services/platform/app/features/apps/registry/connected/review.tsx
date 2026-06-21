'use client';

/**
 * Connected `ReviewQueue` block — binds an allowlisted approvals query and lists
 * the pending items, generic over whatever approval rows the bound query returns.
 */
import { Badge } from '@tale/ui/badge';
import { Card } from '@tale/ui/card';
import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { ClipboardCheck } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundQuery } from '../../hooks/use-bound-query';
import { usePackLabelString } from '../../runtime/app-runtime';
import { Section } from './section';

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
  const labelOf = usePackLabelString();
  const { data, blocked } = useBoundQuery(query.path, query.args);
  const rows = (Array.isArray(data) ? data : []).filter(isRecord);

  return (
    <Section title={labelOf(title)} icon={ClipboardCheck}>
      {blocked ? (
        <Text variant="error">
          {t('binding.blocked', { path: query.path })}
        </Text>
      ) : rows.length === 0 ? (
        <Text variant="muted">{t('review.none')}</Text>
      ) : (
        <VStack gap={2}>
          {rows.map((row, i) => (
            <Card key={i}>
              <HStack gap={3} className="items-center justify-between">
                <Text as="span">{label(row)}</Text>
                <Badge variant="yellow">{t('review.awaiting')}</Badge>
              </HStack>
            </Card>
          ))}
        </VStack>
      )}
    </Section>
  );
}
