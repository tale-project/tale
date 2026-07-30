'use client';

import { useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useThreadActions } from '../data/thread-actions';
import type { ChatThreadSummary } from '../types';

/** The delete confirmation — Delete moves the chat to Trash, where the org's
 * grace window keeps it restorable before retention purges it. Shared by the
 * sidebar row menu and the conversation header menu. */
export function ThreadDeleteDialog({
  thread,
  organizationId,
  open,
  onOpenChange,
  onDeleted,
}: {
  thread: Pick<ChatThreadSummary, 'id' | 'title'>;
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs after a successful delete — leave the dead conversation. */
  onDeleted?: () => void;
}) {
  const { t } = useT('chat');
  const actions = useThreadActions(organizationId);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = () => {
    setDeleting(true);
    void actions
      .trash(thread.id)
      .then((ok) => {
        if (!ok) {
          toast({ title: t('deleteFailed'), variant: 'destructive' });
          return;
        }
        onOpenChange(false);
        onDeleted?.();
      })
      .finally(() => setDeleting(false));
  };

  return (
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('deleteConfirmation', {
        title: thread.title ?? t('history.untitled'),
      })}
      description={t('deletePermanentMessage')}
      deleteText={t('deleteChat')}
      isDeleting={deleting}
      onDelete={handleDelete}
    />
  );
}
