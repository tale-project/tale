'use client';

import { Button } from '@tale/ui/button';
import { HStack } from '@tale/ui/layout';
import { useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import {
  useArchiveAllThreads,
  useDeleteAllThreads,
} from '@/app/features/chat/hooks/mutations';
import { useChatCounts } from '@/app/features/chat/hooks/queries';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

/**
 * Account-settings section for bulk-managing the signed-in user's own chats.
 * "Archive all" moves every active chat to the archived section (restorable);
 * "Delete all" moves every active and archived chat to Trash. Both confirm
 * first and report how many chats they touched. Counts come from
 * `useChatCounts`, which also gates the buttons when there's nothing to do.
 */
export function ChatsSection() {
  const { t } = useT('settings');
  const organizationId = useOrganizationId();
  const { toast } = useToast();

  const { data: counts } = useChatCounts(organizationId);
  const { mutate: archiveAll, isPending: isArchiving } = useArchiveAllThreads();
  const { mutate: deleteAll, isPending: isDeleting } = useDeleteAllThreads();

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const activeCount = counts?.active ?? 0;
  const archivedCount = counts?.archived ?? 0;
  const deletableCount = activeCount + archivedCount;

  const handleArchiveAll = () => {
    archiveAll(
      { organizationId },
      {
        onSuccess: ({ scheduled }) => {
          setArchiveOpen(false);
          toast({
            title: t('account.chats.archiveStarted', { count: scheduled }),
            variant: 'success',
          });
        },
        onError: (error) => {
          console.error('Failed to archive all chats:', error);
          toast({
            title: t('account.chats.actionFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleDeleteAll = () => {
    deleteAll(
      { organizationId },
      {
        onSuccess: ({ scheduled }) => {
          setDeleteOpen(false);
          toast({
            title: t('account.chats.deleteStarted', { count: scheduled }),
            variant: 'success',
          });
        },
        onError: (error) => {
          console.error('Failed to delete all chats:', error);
          toast({
            title: t('account.chats.actionFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  return (
    <SettingsSection
      className="border-border border-t pt-8"
      title={t('account.chats.title')}
      description={t('account.chats.description')}
      action={
        <HStack gap={2}>
          <Button
            variant="secondary"
            disabled={activeCount === 0 || isArchiving}
            onClick={() => setArchiveOpen(true)}
          >
            {t('account.chats.archiveAll')}
          </Button>
          <Button
            variant="destructive"
            disabled={deletableCount === 0 || isDeleting}
            onClick={() => setDeleteOpen(true)}
          >
            {t('account.chats.deleteAll')}
          </Button>
        </HStack>
      }
    >
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={t('account.chats.archiveConfirmTitle')}
        description={t('account.chats.archiveConfirmDescription', {
          count: activeCount,
        })}
        confirmText={t('account.chats.archiveAll')}
        isLoading={isArchiving}
        onConfirm={handleArchiveAll}
      />

      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('account.chats.deleteConfirmTitle')}
        description={t('account.chats.deleteConfirmDescription', {
          count: deletableCount,
        })}
        warning={t('account.chats.deletePermanentMessage')}
        deleteText={t('account.chats.deleteAll')}
        isDeleting={isDeleting}
        onDelete={handleDeleteAll}
      />
    </SettingsSection>
  );
}
