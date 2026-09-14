'use client';

import { Badge } from '@tale/ui/badge';
import { BorderedSection } from '@tale/ui/bordered-section';
import { Button } from '@tale/ui/button';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { ViewDialog } from '@tale/ui/dialog/view-dialog';
import { Heading } from '@tale/ui/heading';
import { IconButton } from '@tale/ui/icon-button';
import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { Pencil } from 'lucide-react';
import { useCallback, useState } from 'react';

import { RagStatusBadge } from '@/app/features/documents/components/rag-status-badge';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { useKnowledgeEntryVersions } from '../hooks/queries';
import type { KnowledgeEntryItem } from '../hooks/queries';
import {
  KNOWLEDGE_ENTRY_EDIT_FORM_ID,
  KnowledgeEntryEditFields,
  useKnowledgeEntryEditForm,
} from './knowledge-entry-edit-form';

interface ViewKnowledgeEntryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  entry: KnowledgeEntryItem;
}

/**
 * Knowledge-entry card (row click). Topic is the view title; source and
 * RAG status sit on the title row. Edit morphs in place on
 * `size="default"` — "Edit knowledge entry", no status chrome on the
 * form. Version history stays an expandable payload in the view (it has
 * content); a failed empty row is a line, not a card with a chevron.
 */
export function ViewKnowledgeEntryDialog({
  isOpen,
  onClose,
  entry,
}: ViewKnowledgeEntryDialogProps) {
  const { t } = useT('knowledgeEntries');
  const { t: tCommon } = useT('common');
  const { formatDate } = useFormatDate();
  const ability = useAbility();
  const canEdit = ability.can('write', 'knowledgeWrite');
  const [isEditing, setIsEditing] = useState(false);
  const { data: versionData } = useKnowledgeEntryVersions(entry._id);
  const { register, errors, isPending, reset, submit } =
    useKnowledgeEntryEditForm(entry, () => setIsEditing(false));

  const versions = versionData?.versions ?? [];
  const sourceLabel =
    entry.source === 'chat' ? t('source.chat') : t('source.manual');

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        reset({ topic: entry.topic, content: entry.content });
        setIsEditing(false);
        onClose();
      }
    },
    [entry.content, entry.topic, onClose, reset],
  );

  const startEdit = useCallback(() => {
    reset({ topic: entry.topic, content: entry.content });
    setIsEditing(true);
  }, [entry.content, entry.topic, reset]);

  const cancelEdit = useCallback(() => {
    reset({ topic: entry.topic, content: entry.content });
    setIsEditing(false);
  }, [entry.content, entry.topic, reset]);

  const headerActions = (
    <>
      <RagStatusBadge
        status={entry.ragStatus}
        indexedAt={entry.ragIndexedAt}
        error={entry.ragError}
        errorCode={entry.ragErrorCode}
        documentId={entry.documentId ? entry.documentId : undefined}
      />
      {canEdit && !isEditing ? (
        <IconButton
          icon={Pencil}
          size="sm"
          aria-label={tCommon('actions.edit')}
          onClick={startEdit}
        />
      ) : null}
    </>
  );

  return (
    <ViewDialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      title={isEditing ? t('editEntry') : entry.topic}
      description={isEditing ? undefined : sourceLabel}
      size="default"
      headerActions={isEditing ? undefined : headerActions}
      customFooter={
        isEditing ? (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={cancelEdit}
              disabled={isPending}
            >
              {tCommon('actions.cancel')}
            </Button>
            <Button
              type="submit"
              form={KNOWLEDGE_ENTRY_EDIT_FORM_ID}
              disabled={isPending}
              isLoading={isPending}
            >
              {tCommon('actions.save')}
            </Button>
          </>
        ) : undefined
      }
    >
      {isEditing ? (
        <form
          id={KNOWLEDGE_ENTRY_EDIT_FORM_ID}
          onSubmit={submit}
          className="space-y-4"
          noValidate
        >
          <KnowledgeEntryEditFields
            register={register}
            errors={errors}
            disabled={isPending}
            autoFocus
          />
        </form>
      ) : (
        <>
          <Text className="max-h-72 overflow-y-auto leading-relaxed whitespace-pre-wrap">
            {entry.content}
          </Text>

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
        </>
      )}
    </ViewDialog>
  );
}
