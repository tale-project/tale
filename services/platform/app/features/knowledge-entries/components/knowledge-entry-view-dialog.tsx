'use client';

import { Badge } from '@tale/ui/badge';
import { BorderedSection } from '@tale/ui/bordered-section';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { Heading } from '@tale/ui/heading';
import { HStack } from '@tale/ui/layout';
import { type StatGridItem, StatGrid } from '@tale/ui/stat-grid';
import { Text } from '@tale/ui/text';
import { useMemo } from 'react';

import { CopyableTimestamp } from '@/app/components/ui/data-display/copyable-timestamp';
import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { RagStatusBadge } from '@/app/features/documents/components/rag-status-badge';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';

import { useKnowledgeEntryVersions } from '../hooks/queries';
import type { KnowledgeEntryItem } from '../hooks/queries';

interface ViewKnowledgeEntryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  entry: KnowledgeEntryItem;
}

export function ViewKnowledgeEntryDialog({
  isOpen,
  onClose,
  entry,
}: ViewKnowledgeEntryDialogProps) {
  const { t } = useT('knowledgeEntries');
  const { formatDate } = useFormatDate();
  const { data: versionData } = useKnowledgeEntryVersions(entry._id);

  const versions = versionData?.versions ?? [];

  const items = useMemo<StatGridItem[]>(
    () => [
      {
        label: t('topic'),
        value: <Text>{entry.topic}</Text>,
      },
      {
        label: t('headers.source'),
        value: (
          <Badge variant="outline">
            {entry.source === 'chat' ? t('source.chat') : t('source.manual')}
          </Badge>
        ),
      },
      {
        label: t('viewDialog.indexingStatus'),
        value: (
          <RagStatusBadge
            status={entry.ragStatus}
            indexedAt={entry.ragIndexedAt}
            error={entry.ragError}
            documentId={entry.documentId ? String(entry.documentId) : undefined}
          />
        ),
      },
      {
        label: t('viewDialog.updated'),
        value: <CopyableTimestamp date={entry.createdAt} preset="long" />,
      },
      {
        label: t('content'),
        value: (
          <Text className="max-h-72 overflow-y-auto whitespace-pre-wrap">
            {entry.content}
          </Text>
        ),
        colSpan: 2,
      },
    ],
    [entry, t],
  );

  return (
    <ViewDialog
      open={isOpen}
      onOpenChange={onClose}
      title={t('viewDialog.title')}
      size="wide"
    >
      <StatGrid items={items} />

      {versions.length > 0 && (
        <div className="mt-6 space-y-3">
          <HStack justify="between" align="center">
            <Heading level={2} size="sm" weight="semibold">
              {t('viewDialog.history')}
            </Heading>
            <Text variant="caption">
              {t('viewDialog.versionCount', { count: versions.length })}
            </Text>
          </HStack>

          {versions.map((version) => (
            <BorderedSection key={version._id}>
              <CollapsibleDetails
                summary={
                  <div className="min-w-0 flex-1 space-y-1">
                    <HStack gap={2} align="center">
                      <Badge variant="outline">
                        {t('viewDialog.superseded')}
                      </Badge>
                      <Text variant="caption">
                        {version.supersededAt
                          ? t('viewDialog.supersededOn', {
                              date: formatDate(
                                new Date(version.supersededAt),
                                'long',
                              ),
                            })
                          : formatDate(new Date(version.createdAt), 'long')}
                      </Text>
                    </HStack>
                    <Text variant="caption" className="break-words">
                      {version.topic}
                    </Text>
                  </div>
                }
              >
                <Text className="mt-3 max-h-48 overflow-y-auto text-sm wrap-break-word whitespace-pre-wrap">
                  {version.content}
                </Text>
              </CollapsibleDetails>
            </BorderedSection>
          ))}
        </div>
      )}
    </ViewDialog>
  );
}
