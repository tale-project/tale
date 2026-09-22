'use client';

import { Badge } from '@tale/ui/badge';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import {
  EntityViewDialog,
  EntityViewSection,
} from '@tale/ui/entity/entity-view-dialog';
import { Row, Stack } from '@tale/ui/layout';
import type { StatGridItem } from '@tale/ui/stat-grid';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { BookOpen } from 'lucide-react';
import { type RefObject, useMemo } from 'react';

import { RagStatusBadge } from '@/app/features/documents/components/rag-status-badge';
import { sourceLabelKey } from '@/app/features/knowledge-entries/lib/source-label';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { useKnowledgeEntryVersions } from '../hooks/queries';
import type { KnowledgeEntryItem } from '../hooks/queries';
import { KnowledgeEntryEditDialog } from './knowledge-entry-edit-dialog';

interface KnowledgeEntryViewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  entry: KnowledgeEntryItem;
  /** Stable focus target when the opener (a row menu item) unmounts. */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

export function KnowledgeEntryViewDialog({
  isOpen,
  onClose,
  entry,
  restoreFocusRef,
}: KnowledgeEntryViewDialogProps) {
  const { t } = useT('knowledgeEntries');
  const { t: tCommon } = useT('common');
  const { formatDate } = useFormatDate();
  const ability = useAbility();
  const canWrite = ability.can('write', 'knowledgeWrite');
  const { data: versionData } = useKnowledgeEntryVersions(entry._id);

  // The chain includes the current version; the history lists the ones it
  // replaced.
  const versions = (versionData?.versions ?? []).filter(
    (version) => version.status === 'superseded',
  );

  const facts = useMemo<StatGridItem[]>(
    () => [
      {
        label: t('headers.source'),
        value: <Text>{t(`source.${sourceLabelKey(entry.source)}`)}</Text>,
      },
      {
        label: t('viewDialog.updated'),
        value: <Text>{formatDate(new Date(entry.createdAt), 'long')}</Text>,
      },
    ],
    [entry, t, formatDate],
  );

  return (
    <EntityViewDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('viewDialog.title')}
      name={entry.topic}
      icon={BookOpen}
      badges={
        <RagStatusBadge
          status={entry.ragStatus}
          indexedAt={entry.ragIndexedAt}
          error={entry.ragError}
          errorCode={entry.ragErrorCode}
          documentId={entry.documentId ? entry.documentId : undefined}
        />
      }
      edit={
        canWrite
          ? {
              label: tCommon('actions.edit'),
              render: ({ onBack, onDone }) => (
                <KnowledgeEntryEditDialog
                  isOpen
                  onClose={onBack}
                  onSaved={onDone}
                  restoreFocusRef={restoreFocusRef}
                  entry={entry}
                />
              ),
            }
          : undefined
      }
      identifier={{ label: t('viewDialog.entryId'), value: entry._id }}
      content={
        <Text className="leading-relaxed wrap-anywhere whitespace-pre-wrap">
          {entry.content}
        </Text>
      }
      facts={facts}
      restoreFocusRef={restoreFocusRef}
    >
      {versions.length > 0 && (
        <EntityViewSection
          title={t('viewDialog.history')}
          meta={t('viewDialog.versionCount', { count: versions.length })}
        >
          <Stack gap={2}>
            {versions.map((version) => (
              <div
                key={version._id}
                className="border-border border-b py-3 last:border-0 last:pb-0"
              >
                <CollapsibleDetails
                  summary={
                    <Stack gap={1} className="min-w-0 flex-1">
                      <Row gap={2} wrap>
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
                      </Row>
                      <Text variant="caption" className="wrap-anywhere">
                        {version.topic}
                      </Text>
                    </Stack>
                  }
                >
                  <Text className="mt-3 text-sm wrap-anywhere whitespace-pre-wrap">
                    {version.content}
                  </Text>
                </CollapsibleDetails>
              </div>
            ))}
          </Stack>
        </EntityViewSection>
      )}
    </EntityViewDialog>
  );
}
