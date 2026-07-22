'use client';

import {
  type DropdownMenuGroup,
  type DropdownMenuItem,
} from '@tale/ui/dropdown-menu';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Download,
  Files,
  FolderInput,
  FolderMinus,
  FolderPlus,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { ProjectAvatar } from '@/app/features/projects/components/project-avatar';
import { ProjectCreateDialog } from '@/app/features/projects/components/project-create-dialog';
import { useMoveThreadToProject } from '@/app/features/projects/hooks/mutations';
import { useProjects } from '@/app/features/projects/hooks/queries';
import { useLegalHoldByTarget } from '@/app/features/settings/governance/hooks/queries';
import { useToast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import {
  useArchiveThread,
  useDeleteThread,
  useSetThreadPinned,
  useUnarchiveThread,
} from './mutations';

export interface UseChatContextMenuOptions {
  chat: { id: string; title: string };
  organizationId: string;
  /**
   * `'header'` — the active-thread overflow menu next to Share (View files +
   * Export are wired by the header via `viewFiles`/`onExport`).
   * `'sidebar'` — a chat-row menu (inline Rename via `onRename`).
   */
  placement: 'header' | 'sidebar';
  /** The currently-open thread; used to route away after delete/archive. */
  currentChatId?: string;
  isPinned?: boolean;
  isArchived?: boolean;
  /** The project this chat currently belongs to, if any. */
  projectId?: string;
  /** Inline rename entry (sidebar rows only). */
  onRename?: () => void;
  /** "View files in chat" (header only) — shown only when `visible`. */
  viewFiles?: { visible: boolean; onSelect: () => void };
  /** "Export" entry (header only). */
  onExport?: () => void;
}

/**
 * The single source of truth for the per-chat context menu, shared by the chat
 * header overflow menu and the sidebar chat-row menu. Owns the pin / archive /
 * delete / move-to-project handlers and the Delete + "New project" dialogs, and
 * assembles the menu groups for the given `placement`. Returns `items` (feed to
 * `<DropdownMenu items=… />`) and `dialogs` (render once alongside the trigger).
 */
export function useChatContextMenu({
  chat,
  organizationId,
  placement,
  currentChatId,
  isPinned = false,
  isArchived = false,
  projectId,
  onRename,
  viewFiles,
  onExport,
}: UseChatContextMenuOptions): {
  items: DropdownMenuGroup[];
  dialogs: ReactNode;
  /** Wire to the menu's `onOpenChange` so the drill-down resets on close. */
  onMenuOpenChange: (open: boolean) => void;
} {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  // "Move to project" drills DOWN in place (swaps this panel's contents) rather
  // than flying out sideways — a lateral submenu has no room in the left-docked
  // / mobile sidebar and spills off-screen.
  const [inMoveView, setInMoveView] = useState(false);

  const { t: tCommon } = useT('common');
  const { t: tChat } = useT('chat');
  const { t: tGovernance } = useT('governance');
  const { t: tProjects } = useT('projects');

  // Read-only consultation so archive/delete can show "blocked by legal hold".
  // Reactive: a hold placed via the governance panel disables these actions.
  const { data: hold } = useLegalHoldByTarget({
    organizationId,
    targetType: 'thread',
    targetId: chat.id,
  });
  const isHeld = hold !== null && hold !== undefined;

  const { projects } = useProjects(organizationId);

  const { mutate: deleteThread, isPending: isDeleting } = useDeleteThread();
  const { mutate: archiveThread } = useArchiveThread();
  const { mutate: unarchiveThread } = useUnarchiveThread();
  const { mutate: setThreadPinned } = useSetThreadPinned();
  const { mutate: moveThreadToProject } = useMoveThreadToProject();

  const goToChatRoot = useCallback(() => {
    if (currentChatId === chat.id) {
      void navigate({
        to: '/dashboard/$id/chat',
        params: { id: organizationId },
      });
    }
  }, [chat.id, currentChatId, organizationId, navigate]);

  const handleDelete = useCallback(() => {
    deleteThread(
      { threadId: chat.id },
      {
        onSuccess: () => {
          setIsDeleteDialogOpen(false);
          goToChatRoot();
        },
        onError: (error) => {
          console.error('Failed to delete chat:', error);
          toast({ title: tChat('deleteFailed'), variant: 'destructive' });
        },
      },
    );
  }, [chat.id, deleteThread, goToChatRoot, toast, tChat]);

  const handleArchive = useCallback(() => {
    archiveThread(
      { threadId: chat.id },
      {
        onSuccess: () => {
          goToChatRoot();
          toast({ title: tChat('archiveSuccess') });
        },
        onError: (error) => {
          console.error('Failed to archive chat:', error);
          toast({ title: tChat('archiveFailed'), variant: 'destructive' });
        },
      },
    );
  }, [chat.id, archiveThread, goToChatRoot, toast, tChat]);

  const handleUnarchive = useCallback(() => {
    unarchiveThread(
      { threadId: chat.id },
      {
        onSuccess: () => toast({ title: tChat('unarchiveSuccess') }),
        onError: (error) => {
          console.error('Failed to unarchive chat:', error);
          toast({ title: tChat('unarchiveFailed'), variant: 'destructive' });
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

  const handleMoveToProject = useCallback(
    (targetProjectId: Id<'projects'>) => {
      moveThreadToProject(
        { threadId: chat.id, projectId: targetProjectId },
        {
          onSuccess: () => toast({ title: tProjects('composer.moveSuccess') }),
          onError: (error: unknown) => {
            console.error('Failed to move chat to project:', error);
            toast({
              title: tProjects('composer.moveError'),
              variant: 'destructive',
            });
          },
        },
      );
    },
    [chat.id, moveThreadToProject, toast, tProjects],
  );

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

  const items = useMemo<DropdownMenuGroup[]>(() => {
    const heldNotice: DropdownMenuGroup | null = isHeld
      ? [
          {
            type: 'label' as const,
            content: tGovernance('legalHold.badges.blockedByHold'),
          },
        ]
      : null;

    const deleteItem: DropdownMenuItem = {
      type: 'item',
      label: tCommon('actions.delete'),
      icon: Trash2,
      destructive: true,
      disabled: isHeld,
      onClick: () => setIsDeleteDialogOpen(true),
    };

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
        [deleteItem],
      ];
    }

    // Drilled INTO the move view: a Back row, then New project + the project
    // list, then Remove — all in this same anchored panel, so nothing spills.
    if (inMoveView) {
      const projectRows: DropdownMenuItem[] =
        projects.length > 0
          ? projects.map((project) => {
              const isCurrent = project._id === projectId;
              return {
                type: 'item' as const,
                label: (
                  <span className="flex min-w-0 items-center gap-2">
                    <ProjectAvatar
                      name={project.name}
                      icon={project.icon}
                      color={project.color}
                      size={16}
                      variant="plain"
                    />
                    <span className="truncate">{project.name}</span>
                  </span>
                ),
                disabled: isCurrent,
                selected: isCurrent,
                onClick: isCurrent
                  ? undefined
                  : () => handleMoveToProject(project._id),
              };
            })
          : [{ type: 'label' as const, content: tProjects('picker.empty') }];

      return [
        [
          {
            type: 'item' as const,
            label: tProjects('picker.title'),
            icon: ChevronLeft,
            keepOpen: true,
            onClick: () => setInMoveView(false),
          },
        ],
        [
          {
            type: 'item' as const,
            label: tChat('newProject'),
            icon: FolderPlus,
            onClick: () => setIsCreateProjectOpen(true),
          },
          ...projectRows,
        ],
        ...(projectId
          ? [
              [
                {
                  type: 'item' as const,
                  label: tChat('removeFromProject'),
                  icon: FolderMinus,
                  onClick: handleRemoveFromProject,
                },
              ],
            ]
          : []),
      ];
    }

    const primary: DropdownMenuItem[] = [];
    if (placement === 'header' && viewFiles?.visible) {
      primary.push({
        type: 'item',
        label: tChat('viewFiles'),
        icon: Files,
        onClick: viewFiles.onSelect,
      });
    }
    // Enters the drill-down (see `inMoveView`). `keepOpen` swaps the panel in
    // place instead of closing; the chevron signals the drill-in.
    primary.push({
      type: 'item',
      label: tProjects('picker.title'),
      icon: FolderInput,
      trailing: <ChevronRight className="size-4" />,
      keepOpen: true,
      onClick: () => setInMoveView(true),
    });
    primary.push({
      type: 'item',
      label: isPinned ? tChat('unpinChat') : tChat('pinChat'),
      icon: isPinned ? PinOff : Pin,
      onClick: handleTogglePin,
    });
    if (onRename) {
      primary.push({
        type: 'item',
        label: tCommon('actions.rename'),
        icon: Pencil,
        onClick: onRename,
      });
    }
    primary.push({
      type: 'item',
      label: tChat('archive'),
      icon: Archive,
      disabled: isHeld,
      onClick: handleArchive,
    });
    if (placement === 'header' && onExport) {
      primary.push({
        type: 'item',
        label: tChat('export.button'),
        icon: Download,
        onClick: onExport,
      });
    }

    return [...(heldNotice ? [heldNotice] : []), primary, [deleteItem]];
  }, [
    placement,
    isArchived,
    isHeld,
    isPinned,
    projectId,
    projects,
    inMoveView,
    onRename,
    onExport,
    viewFiles,
    handleTogglePin,
    handleArchive,
    handleUnarchive,
    handleMoveToProject,
    handleRemoveFromProject,
    tChat,
    tCommon,
    tGovernance,
    tProjects,
  ]);

  const dialogs = (
    <>
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

      <ProjectCreateDialog
        open={isCreateProjectOpen}
        onOpenChange={setIsCreateProjectOpen}
        organizationId={organizationId}
        navigateOnCreate={false}
        onCreated={handleMoveToProject}
      />
    </>
  );

  const onMenuOpenChange = useCallback((open: boolean) => {
    // Always reopen at the root list, never mid-drill-down.
    if (!open) setInMoveView(false);
  }, []);

  return { items, dialogs, onMenuOpenChange };
}
