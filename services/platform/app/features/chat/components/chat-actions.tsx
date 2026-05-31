'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  FolderMinus,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { useMoveThreadToProject } from '@/app/features/projects/hooks/mutations';
import { useLegalHoldByTarget } from '@/app/features/settings/governance/hooks/queries';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  useArchiveThread,
  useDeleteThread,
  useSetThreadPinned,
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
  isPinned?: boolean;
  /** The project this chat currently belongs to, if any. When set, the menu
   * offers "Remove from project" (chats are otherwise only added to a project
   * by dragging onto a folder). */
  projectId?: string;
}

export function ChatActions({
  chat,
  currentChatId,
  organizationId,
  onRename,
  isArchived = false,
  isPinned = false,
  projectId,
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
  // automatically disables these actions. Cascade-includes user-custodian
  // hits via the thread author.
  const { data: hold } = useLegalHoldByTarget({
    organizationId,
    targetType: 'thread',
    targetId: chat.id,
  });
  const isHeld = hold !== null && hold !== undefined;

  const { mutate: deleteThread, isPending: isDeleting } = useDeleteThread();
  const { mutate: archiveThread } = useArchiveThread();
  const { mutate: unarchiveThread } = useUnarchiveThread();
  const { mutate: setThreadPinned } = useSetThreadPinned();
  const { mutate: moveThreadToProject } = useMoveThreadToProject();

  const handleRemoveFromProject = useCallback(() => {
    moveThreadToProject(
      { threadId: chat.id, projectId: null },
      {
        onError: (error: unknown) => {
          console.error('Failed to remove chat from project:', error);
          toast({
            title: tChat('removeFromProjectFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [chat.id, moveThreadToProject, toast, tChat]);

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

  const handleTogglePin = useCallback(() => {
    setThreadPinned(
      { threadId: chat.id, pinned: !isPinned },
      {
        onError: (error) => {
          console.error('Failed to update pin:', error);
          toast({ title: tChat('pinFailed'), variant: 'destructive' });
        },
      },
    );
  }, [chat.id, isPinned, setThreadPinned, toast, tChat]);

  const menuItems = useMemo<DropdownMenuGroup[]>(() => {
    // Surface the legal-hold reason as a leading label so disabled
    // archive/delete items aren't unexplained (the tooltip the old icon
    // row carried is unavailable inside a menu).
    const heldNotice: DropdownMenuGroup | null = isHeld
      ? [
          {
            type: 'label' as const,
            content: tGovernance('legalHold.badges.blockedByHold'),
          },
        ]
      : null;

    if (isArchived) {
      return [
        ...(heldNotice ? [heldNotice] : []),
        [
          {
            type: 'item' as const,
            label: tChat('unarchive'),
            icon: ArchiveRestore,
            disabled: isHeld,
            onClick: handleUnarchive,
          },
        ],
        [
          {
            type: 'item' as const,
            label: tCommon('actions.delete'),
            icon: Trash2,
            destructive: true,
            disabled: isHeld,
            onClick: () => setIsDeleteDialogOpen(true),
          },
        ],
      ];
    }

    return [
      ...(heldNotice ? [heldNotice] : []),
      [
        {
          type: 'item' as const,
          label: isPinned ? tChat('unpinChat') : tChat('pinChat'),
          icon: isPinned ? PinOff : Pin,
          onClick: handleTogglePin,
        },
        ...(onRename
          ? [
              {
                type: 'item' as const,
                label: tCommon('actions.rename'),
                icon: Pencil,
                onClick: onRename,
              },
            ]
          : []),
        ...(projectId
          ? [
              {
                type: 'item' as const,
                label: tChat('removeFromProject'),
                icon: FolderMinus,
                onClick: handleRemoveFromProject,
              },
            ]
          : []),
        {
          type: 'item' as const,
          label: tChat('archive'),
          icon: Archive,
          disabled: isHeld,
          onClick: handleArchive,
        },
      ],
      [
        {
          type: 'item' as const,
          label: tCommon('actions.delete'),
          icon: Trash2,
          destructive: true,
          disabled: isHeld,
          onClick: () => setIsDeleteDialogOpen(true),
        },
      ],
    ];
  }, [
    isArchived,
    isPinned,
    isHeld,
    onRename,
    projectId,
    handleTogglePin,
    handleArchive,
    handleUnarchive,
    handleRemoveFromProject,
    tChat,
    tCommon,
    tGovernance,
  ]);

  return (
    <>
      <DropdownMenu
        align="end"
        trigger={
          <Button
            variant="ghost"
            className="p-1"
            size="icon"
            aria-label={tChat('moreActions')}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        }
        items={menuItems}
      />

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
