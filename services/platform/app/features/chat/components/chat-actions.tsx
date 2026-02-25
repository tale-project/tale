'use client';

import { useNavigate } from '@tanstack/react-router';
import { Pencil, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { ActionRow } from '@/app/components/ui/layout/action-row';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useDeleteThread } from '../hooks/mutations';

interface ChatActionsProps {
  chat: {
    id: string;
    title: string;
  };
  currentChatId?: string;
  organizationId: string;
  onRename?: () => void;
}

export function ChatActions({
  chat,
  currentChatId,
  organizationId,
  onRename,
}: ChatActionsProps) {
  const navigate = useNavigate();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const { toast } = useToast();

  const { t: tCommon } = useT('common');
  const { t: tChat } = useT('chat');

  const { mutate: deleteThread, isPending: isLoading } = useDeleteThread();

  const handleDelete = useCallback(() => {
    deleteThread(
      { threadId: chat.id },
      {
        onSuccess: () => {
          setIsDeleteDialogOpen(false);

          if (currentChatId === chat.id) {
            void navigate({
              to: '/dashboard/$id/chat',
              params: { id: organizationId },
            });
          }
        },
        onError: (error) => {
          console.error('Failed to delete chat:', error);
          toast({
            title: tChat('deleteFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [
    chat.id,
    currentChatId,
    organizationId,
    deleteThread,
    navigate,
    toast,
    tChat,
  ]);

  return (
    <>
      <ActionRow gap={1}>
        <Tooltip content={tCommon('actions.rename')} side="bottom">
          <Button
            variant="ghost"
            className="hidden p-1 md:inline-flex"
            size="icon"
            onClick={onRename}
            aria-label={tCommon('actions.rename')}
          >
            <Pencil className="size-4" />
          </Button>
        </Tooltip>

        <Tooltip content={tCommon('actions.delete')} side="bottom">
          <Button
            variant="ghost"
            className="p-1"
            size="icon"
            onClick={() => setIsDeleteDialogOpen(true)}
            aria-label={tCommon('actions.delete')}
          >
            <Trash2 className="size-4" />
          </Button>
        </Tooltip>
      </ActionRow>

      <DeleteDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title={tChat('deleteChat')}
        description={
          <>
            {(() => {
              const parts = tChat('deleteConfirmation', {
                title: '\x00',
              }).split('\x00');
              if (parts.length < 2) {
                return tChat('deleteConfirmation', { title: chat.title });
              }
              return (
                <>
                  {parts[0]}
                  <Text as="span" variant="body" className="font-semibold">
                    {chat.title}
                  </Text>
                  {parts[1]}
                </>
              );
            })()}
            <br />
            <br />
            <Text as="span" variant="muted">
              {tChat('deleteArchiveMessage')}
            </Text>
          </>
        }
        deleteText={tChat('deleteChat')}
        isDeleting={isLoading}
        onDelete={handleDelete}
      />
    </>
  );
}
