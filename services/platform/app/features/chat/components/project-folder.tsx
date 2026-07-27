'use client';

/**
 * The PROJECTS section's building blocks: one project folder (a disclosure
 * row that is also a drag-and-drop target for filing chats) and the loose
 * CHATS drop zone that takes a chat back out of any project.
 *
 * Extracted from `thread-list.tsx` verbatim so the list file owns sections
 * and data flow while this one owns the folder/drop-zone presentation.
 */

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import {
  Archive,
  ChevronDown,
  MoreHorizontal,
  Pin,
  PinOff,
  SquarePen,
  Trash2,
} from 'lucide-react';
import type { ReactNode } from 'react';

import {
  SUB_PANEL_ROW_CLASS,
  SubPanelDisclosureBody,
} from '@/app/components/layout/sub-panel-list';
import { ProjectAvatar } from '@/app/features/projects/components/project-avatar';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useProjectPin } from '../data/chat-backend';
import type { ChatProjectSummary, ChatThreadSummary } from '../types';
import {
  dropZoneClassName,
  useProjectDropZone,
  useThreadDndState,
} from './thread-dnd';
import { useThreadListFrame } from './thread-list-context';
import { ThreadRow } from './thread-row';

export function ProjectFolder({
  project,
  threads,
  explicitCollapsed,
  onSetCollapsed,
}: {
  project: ChatProjectSummary;
  threads: readonly ChatThreadSummary[];
  /** Persisted user choice for this folder; `undefined` until toggled. */
  explicitCollapsed?: boolean;
  onSetCollapsed: (collapsed: boolean) => void;
}) {
  const { t } = useT('chat');
  const { t: tProjects } = useT('projects');
  const navigate = useNavigate();
  const { organizationId, activeThreadId } = useThreadListFrame();
  const { setPinned } = useProjectPin();
  const isPinned = !!project.pinnedAt;

  const handleTogglePin = () => {
    setPinned(project.id, !isPinned).catch((error: unknown) => {
      console.error('Failed to update project pin:', error);
      toast({ title: t('pinFailed'), variant: 'destructive' });
    });
  };

  // Start a new chat already filed under this project — the chat index reads
  // the `projectId` search param, so the first send creates a project-linked
  // thread (same path the project Overview's CTA uses).
  const handleNewChat = () => {
    void navigate({
      to: '/dashboard/$id/chat',
      params: { id: organizationId },
      search: { projectId: project.id },
    });
  };

  // Archive and Delete NAVIGATE to the project's danger zone rather than
  // acting from a hover menu — a project deletion deserves its guarded home,
  // and the general page spells out what each action cascades to.
  const handleOpenDangerZone = () => {
    void navigate({
      to: '/dashboard/$id/projects/$projectId',
      params: { id: organizationId, projectId: project.id },
      hash: 'project-danger',
    });
  };

  const menuItems: DropdownMenuGroup[] = [
    [
      {
        type: 'item',
        label: t('newChat'),
        icon: SquarePen,
        onClick: handleNewChat,
      },
      {
        type: 'item',
        label: isPinned ? t('unpinProject') : t('pinProject'),
        icon: isPinned ? PinOff : Pin,
        onClick: handleTogglePin,
      },
    ],
    [
      {
        type: 'item',
        label: tProjects('rowActions.archive'),
        icon: Archive,
        onClick: handleOpenDangerZone,
      },
      {
        type: 'item',
        label: tProjects('rowActions.delete'),
        icon: Trash2,
        destructive: true,
        onClick: handleOpenDangerZone,
      },
    ],
  ];

  const { setNodeRef, isOver } = useProjectDropZone(project.id);

  const containsCurrentThread =
    activeThreadId !== undefined &&
    threads.some((thread) => thread.id === activeThreadId);
  // Collapsed by default; the open/closed choice is remembered once the user
  // toggles it. Until then, the folder holding the open chat starts expanded.
  const collapsed = explicitCollapsed ?? !containsCurrentThread;

  // Projects are always shown — even empty ones — so the list doesn't shift
  // when a drag begins and the PROJECTS section stays stable. An empty folder
  // simply shows a "drop here" hint once expanded.
  return (
    <div ref={setNodeRef} className={dropZoneClassName(isOver)}>
      {/* The hover fill lives on the wrapper (not the disclosure button) so
          the row stays highlighted while the pointer is over the trailing
          menu — a sibling of the button. */}
      <div className="group hover:bg-muted/60 relative flex items-center rounded-md transition-colors">
        <button
          type="button"
          onClick={() => onSetCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-label={project.name}
          className={cn(
            SUB_PANEL_ROW_CLASS,
            'text-muted-foreground group-hover:text-foreground w-full cursor-pointer gap-2 text-left',
          )}
        >
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none',
              collapsed && '-rotate-90',
            )}
            aria-hidden
          />
          <ProjectAvatar
            name={project.name}
            icon={project.icon}
            color={project.color}
            size={16}
            variant="plain"
          />
          <span className="flex-1 truncate leading-snug">{project.name}</span>
          {isPinned && (
            // Hides on hover (desktop) like the count below — the trailing
            // menu lands on this edge and the pin would show through it.
            <Pin
              className="text-muted-foreground size-3 shrink-0 md:group-hover:opacity-0 md:group-has-[[data-state=open]]:opacity-0"
              aria-label={t('pinned')}
            />
          )}
          {/* Plain count, no chip — omitted entirely for empty folders. Hides
              on hover (desktop) to make room for the menu, mirroring the chat
              row's trailing controls. */}
          {threads.length > 0 && (
            <span className="text-muted-foreground text-xs leading-5 font-medium tabular-nums md:group-hover:opacity-0 md:group-has-[[data-state=open]]:opacity-0">
              {threads.length}
            </span>
          )}
        </button>
        <div className="z-10 shrink-0 opacity-100 transition-opacity md:absolute md:top-1/2 md:right-1 md:-translate-y-1/2 md:opacity-0 md:group-hover:opacity-100 md:has-[[data-state=open]]:opacity-100">
          <DropdownMenu
            align="end"
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="size-6 p-1"
                aria-label={t('moreActions')}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            }
            items={menuItems}
          />
        </div>
      </div>
      <SubPanelDisclosureBody open={!collapsed}>
        {threads.length === 0 ? (
          <div className="border-border/60 mt-1 ml-3.5 border-l pl-1.5">
            <Text
              as="div"
              variant="caption"
              className="text-muted-foreground/70 px-2 py-1.5 text-nowrap"
            >
              {t('history.dropHereToAdd')}
            </Text>
          </div>
        ) : (
          <Stack
            as="ul"
            gap={0}
            className="border-border/60 mt-1 ml-3.5 gap-0.5 border-l pl-1.5"
          >
            {threads.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} />
            ))}
          </Stack>
        )}
      </SubPanelDisclosureBody>
    </div>
  );
}

/**
 * The "Chats" (no-project) section as a drop target. Dropping a chat here
 * moves it out of whatever project it was in. When the flat list is empty, a
 * hint appears while dragging so there's still a visible place to drop.
 */
export function LooseThreadsDropZone({
  hasThreads,
  children,
}: {
  hasThreads: boolean;
  children: ReactNode;
}) {
  const { t } = useT('chat');
  const { isDragging } = useThreadDndState();
  const { setNodeRef, isOver } = useProjectDropZone(null);

  return (
    <div ref={setNodeRef} className={dropZoneClassName(isOver)}>
      <Stack as="ul" gap={0} className="gap-0.5">
        {children}
      </Stack>
      {isDragging && !hasThreads && (
        <div
          className={cn(
            'text-muted-foreground rounded-md border border-dashed px-2 py-3 text-center text-xs transition-colors',
            isOver ? 'border-primary bg-accent/40' : 'border-border/70',
          )}
        >
          {t('history.dropToChatsHint')}
        </div>
      )}
    </div>
  );
}
