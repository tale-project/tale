'use client';

/** The operator workspace: header (workflow + execution status) and a toggle
 * between the friendly operator projection and the raw journal. Owns the
 * loading / error / not-found chrome. */
import { Badge } from '@tale/ui/badge';
import { EmptyState } from '@tale/ui/empty-state';
import { HStack, VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Tabs } from '@tale/ui/tabs';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { useExecutionProjection } from '../hooks/use-execution-projection';
import { OperatorView } from './operator-view';
import { RawJournalView } from './raw-journal-view';

type BadgeVariant = 'slate' | 'blue' | 'green' | 'destructive' | 'yellow';

function statusVariant(status: string): BadgeVariant {
  switch (status) {
    case 'running':
      return 'blue';
    case 'completed':
      return 'green';
    case 'failed':
      return 'destructive';
    case 'waiting':
    case 'paused':
      return 'yellow';
    default:
      return 'slate';
  }
}

export function OperatorShell({
  organizationId,
  executionId,
}: {
  organizationId: string;
  executionId: string;
}) {
  const { t } = useT('operator');
  const { projection, isLoading, error } = useExecutionProjection({
    organizationId,
    executionId,
  });
  const [tab, setTab] = useState('operator');

  if (isLoading && !projection) return <SkeletonText lines={6} />;
  if (error) {
    return <EmptyState title={t('error.title')} description={error.message} />;
  }
  if (!projection) return <EmptyState title={t('error.notFound')} />;

  return (
    <VStack gap={4}>
      <HStack gap={2} className="flex-wrap items-center justify-between">
        <Text as="span" className="text-xl font-semibold">
          {projection.workflowName ?? t('title')}
        </Text>
        <Badge variant={statusVariant(projection.status)} dot>
          {t(`execStatus.${projection.status}`, {
            defaultValue: projection.status,
          })}
        </Badge>
      </HStack>
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          {
            value: 'operator',
            label: t('tab.operator'),
            content: <OperatorView projection={projection} />,
          },
          {
            value: 'raw',
            label: t('tab.raw'),
            content: <RawJournalView executionId={executionId} />,
          },
        ]}
      />
    </VStack>
  );
}
