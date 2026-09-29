'use client';

import { Badge } from '@tale/ui/badge';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
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
import { type RefObject, useCallback, useMemo, useRef } from 'react';

import { RagStatusBadge } from '@/app/features/documents/components/rag-status-badge';
import { sourceLabelKey } from '@/app/features/knowledge-entries/lib/source-label';
import { MarkdownContent } from '@/app/features/shared/markdown/markdown-renderer';
import { useAbility } from '@/app/hooks/use-ability';
import { readStateOf } from '@/app/lib/backend/read-state';
import { useT } from '@/lib/i18n/client';

import { useKnowledgeEntryVersions } from '../hooks/queries';
import type { KnowledgeEntryItem } from '../hooks/queries';
import { KnowledgeEntryEditDialog } from './knowledge-entry-edit-dialog';

/**
 * An entry is org-authored prose; rendering it must never load a remote
 * resource, so images are dropped.
 */
const KNOWLEDGE_ENTRY_DISALLOWED_ELEMENTS = ['img'] as const;

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
  const versionsQuery = useKnowledgeEntryVersions(entry._id);
  const { refetch: refetchVersions } = versionsQuery;
  const historyRead = readStateOf(versionsQuery);

  // The chain includes the current version; the history lists the ones it
  // replaced. `null` is a chain the entry has left (it was deleted): no
  // earlier versions to show either.
  const versions = (versionsQuery.data?.versions ?? []).filter(
    (version) => version.status === 'superseded',
  );

  // A retry replaces the control that ran it (with the loading line, or with
  // the versions once they are back), so focus moves onto the section first
  // instead of falling back to the dialog.
  const historyRef = useRef<HTMLElement>(null);
  const retryHistory = useCallback(() => {
    historyRef.current?.focus();
    void refetchVersions();
  }, [refetchVersions]);

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
      // The id is per version: an edit issues a new one and supersedes this
      // row, so the caption says what keeps identifying the entry.
      identifier={{
        label: t('viewDialog.entryId'),
        value: entry._id,
        hint: t('viewDialog.entryIdHint'),
      }}
      content={
        <MarkdownContent
          content={entry.content}
          className="wrap-anywhere"
          disallowedElements={KNOWLEDGE_ENTRY_DISALLOWED_ELEMENTS}
        />
      }
      facts={facts}
      restoreFocusRef={restoreFocusRef}
    >
      {/* Always shown, so loading, "never edited" and a failed read are
          three different answers (#3777) — a failed read used to look like
          an entry with no history. */}
      <EntityViewSection
        title={t('viewDialog.history')}
        meta={
          versions.length > 0
            ? t('viewDialog.versionCount', { count: versions.length })
            : undefined
        }
        focusRef={historyRef}
      >
        {(historyRead.unavailable || historyRead.stale) && (
          <CatalogLoadError
            // A fresh alert for each failure, so a retry that fails again is
            // announced again.
            key={historyRead.failureCount}
            message={t(
              historyRead.stale
                ? 'viewDialog.historyRefreshFailed'
                : 'viewDialog.historyLoadFailed',
            )}
            onRetry={retryHistory}
            isRetrying={historyRead.retrying}
          />
        )}
        {versionsQuery.data === undefined ? (
          historyRead.unavailable ? null : (
            <Text variant="muted" role="status">
              {t('viewDialog.historyLoading')}
            </Text>
          )
        ) : versions.length === 0 ? (
          <Text variant="muted">{t('viewDialog.historyEmpty')}</Text>
        ) : (
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
                  <MarkdownContent
                    content={version.content}
                    className="mt-3 wrap-anywhere"
                    disallowedElements={KNOWLEDGE_ENTRY_DISALLOWED_ELEMENTS}
                  />
                </CollapsibleDetails>
              </div>
            ))}
          </Stack>
        )}
      </EntityViewSection>
    </EntityViewDialog>
  );
}
