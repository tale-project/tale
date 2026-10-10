'use client';

import { DeleteDialog } from '@tale/ui/dialog/delete-dialog';
import { toast } from '@tale/ui/use-toast';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';

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
}: {
  thread: Pick<ChatThreadSummary, 'id' | 'title'>;
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('chat');
  const navigate = useNavigate();
  // The conversation on screen, if any: the header menu deletes it, a row
  // menu deletes it or any other chat.
  const openThreadId = useParams({ strict: false }).threadId;
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
        // Leave the deleted conversation for a fresh chat, in place of its
        // page. Plain `/chat` would resume the most recent chat, and the list
        // still names the deleted one until it has read again.
        if (openThreadId === thread.id) {
          void navigate({
            to: '/dashboard/$id/chat',
            params: { id: organizationId },
            search: { new: true },
            replace: true,
          });
        }
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
