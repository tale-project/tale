'use client';

import { Button } from '@tale/ui/button';
import { useNavigate } from '@tanstack/react-router';
import { Archive, ArchiveRestore, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { ActionRow } from '@/app/components/ui/layout/action-row';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Text } from '@/app/components/ui/typography/text';
import { useLegalHoldByTarget } from '@/app/features/settings/governance/hooks/queries';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  useArchiveThread,
  useDeleteThread,
  useUnarchiveThread,
} from '../hooks/mutations';

interface ChatActionsProps {
  chat: {
    id: string;
    title: string;
  };
  currentChatId?: string;
  organizationId: string;
  onRename?: () => void;
  isArchived?: boolean;
}

export function ChatActions({
  chat,
  currentChatId,
  organizationId,
  onRename,
  isArchived = false,
}: ChatActionsProps) {
  const navigate = useNavigate();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const { toast } = useToast();

  const { t: tCommon } = useT('common');
  const { t: tChat } = useT('chat');
  const { t: tGovernance } = useT('governance');

  // Read-only consultation so archive/delete can show "blocked by legal
  // hold". The query is reactive: a hold placed via the panel (which is
  // the only entry point for placing holds since the User+Org refactor)
  // automatically disables these buttons. Cascade-includes user-custodian
  // hits via the thread author.
  const { data: hold } = useLegalHoldByTarget({
    organizationId,
    targetType: 'thread',
    targetId: chat.id,
  });
  const isHeld = hold !== null && hold !== undefined;

  const { mutate: deleteThread, isPending: isDeleting } = useDeleteThread();
  const { mutate: archiveThread, isPending: isArchiving } = useArchiveThread();
  const { mutate: unarchiveThread, isPending: isUnarchiving } =
    useUnarchiveThread();

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

  const handleArchive = useCallback(() => {
    archiveThread(
      { threadId: chat.id },
      {
        onSuccess: () => {
          if (currentChatId === chat.id) {
            void navigate({
              to: '/dashboard/$id/chat',
              params: { id: organizationId },
            });
          }
          toast({
            title: tChat('archiveSuccess'),
          });
        },
        onError: (error) => {
          console.error('Failed to archive chat:', error);
          toast({
            title: tChat('archiveFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [
    chat.id,
    currentChatId,
    organizationId,
    archiveThread,
    navigate,
    toast,
    tChat,
  ]);

  const handleUnarchive = useCallback(() => {
    unarchiveThread(
      { threadId: chat.id },
      {
        onSuccess: () => {
          toast({
            title: tChat('unarchiveSuccess'),
          });
        },
        onError: (error) => {
          console.error('Failed to unarchive chat:', error);
          toast({
            title: tChat('unarchiveFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [chat.id, unarchiveThread, toast, tChat]);

  if (isArchived) {
    return (
      <>
        <ActionRow gap={1}>
          <Tooltip content={tChat('unarchive')} side="bottom">
            <Button
              variant="ghost"
              className="p-1"
              size="icon"
              onClick={handleUnarchive}
              disabled={isUnarchiving || isHeld}
              aria-label={tChat('unarchive')}
            >
              <ArchiveRestore className="size-4" />
            </Button>
          </Tooltip>

          <Tooltip
            content={
              isHeld
                ? tGovernance('legalHold.badges.blockedByHold')
                : tCommon('actions.delete')
            }
            side="bottom"
          >
            <Button
              variant="ghost"
              className="p-1"
              size="icon"
              onClick={() => setIsDeleteDialogOpen(true)}
              disabled={isHeld}
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
                {tChat('deletePermanentMessage')}
              </Text>
            </>
          }
          deleteText={tChat('deleteChat')}
          isDeleting={isDeleting}
          onDelete={handleDelete}
        />
      </>
    );
  }

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

        <Tooltip
          content={
            isHeld
              ? tGovernance('legalHold.badges.blockedByHold')
              : tChat('archive')
          }
          side="bottom"
        >
          <Button
            variant="ghost"
            className="p-1"
            size="icon"
            onClick={handleArchive}
            disabled={isArchiving || isHeld}
            aria-label={tChat('archive')}
          >
            <Archive className="size-4" />
          </Button>
        </Tooltip>

        <Tooltip
          content={
            isHeld
              ? tGovernance('legalHold.badges.blockedByHold')
              : tCommon('actions.delete')
          }
          side="bottom"
        >
          <Button
            variant="ghost"
            className="p-1"
            size="icon"
            onClick={() => setIsDeleteDialogOpen(true)}
            disabled={isHeld}
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
              {tChat('deletePermanentMessage')}
            </Text>
          </>
        }
        deleteText={tChat('deleteChat')}
        isDeleting={isDeleting}
        onDelete={handleDelete}
      />
    </>
  );
}
