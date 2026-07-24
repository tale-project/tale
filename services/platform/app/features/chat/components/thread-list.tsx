'use client';

/**
 * The chat sub-panel: the org's project folders and every thread the user can
 * open, newest first — built from the same sub-panel list vocabulary the
 * settings rail uses, so the two panels read as siblings.
 *
 * A chat row says three things — the thread's title, whether it runs in a
 * sandbox, and whether a turn is in flight right now. The generating marker
 * comes from the same signal the thread view uses, so a thread never looks
 * idle in the list while it streams in the pane.
 *
 * Filing is drag-and-drop: every project folder is a drop target, and the
 * loose CHATS section is one too, so a chat moves out of a project the same
 * way it moved in. New chat lives on the nav rail, not here.
 */

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Boxes,
  ChevronDown,
  FolderPlus,
  MessageSquareDashed,
  MoreHorizontal,
  Pin,
  PinOff,
  Search,
  SquarePen,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { useOptionalSidebar } from '@/app/components/layout/app-sidebar/sidebar-context';
import { ChatHistorySkeleton } from '@/app/components/layout/chat-history-skeleton';
import {
  SUB_PANEL_ROW_CLASS,
  SubPanelDisclosureBody,
  SubPanelSectionHeader,
  useSubPanelRowTreatment,
} from '@/app/components/layout/sub-panel-list';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { ProjectAvatar } from '@/app/features/projects/components/project-avatar';
import { ProjectCreateDialog } from '@/app/features/projects/components/project-create-dialog';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useChatProjects, useProjectPin } from '../data/chat-backend';
import type { ChatProjectSummary, ChatThreadSummary } from '../types';
import {
  ThreadDndProvider,
  dropZoneClassName,
  useProjectDropZone,
  useThreadDndState,
  useThreadDraggable,
} from './thread-dnd';
import { ThreadShareMenu } from './thread-share-menu';

interface ThreadListProps {
  organizationId: string;
  threads: readonly ChatThreadSummary[];
  activeThreadId?: string;
  /** False while the chat backend has not answered — the skeleton holds. */
  available?: boolean;
}

/** Stable stand-in while the project read has not answered — a fresh `[]` each
 * render would re-run every grouping memo below it. */
const NO_PROJECTS: readonly ChatProjectSummary[] = [];

export function ThreadList({
  organizationId,
  threads,
  activeThreadId,
  available = true,
}: ThreadListProps) {
  const { t } = useT('chat');
  const sidebar = useOptionalSidebar();
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = usePersistedState<
    Record<string, boolean>
  >('chat-sidebar-collapsed-projects', {});

  const projectsQuery = useChatProjects(organizationId);
  const projects =
    projectsQuery.status === 'ready' ? projectsQuery.data : NO_PROJECTS;

  // Folders read like a file tree — pinned projects float to the top, the
  // rest sorted alphabetically by project name.
  const sortedProjects = useMemo(
    () =>
      [...projects].sort((a, b) => {
        if (a.pinnedAt && b.pinnedAt) return b.pinnedAt - a.pinnedAt;
        if (a.pinnedAt) return -1;
        if (b.pinnedAt) return 1;
        return a.name.localeCompare(b.name, undefined, {
          sensitivity: 'base',
        });
      }),
    [projects],
  );

  // Folders own the rows filed under their project; the flat list shows only
  // un-projected chats. A chat pointing at a project the caller can't see
  // (e.g. archived) falls back to the flat list so it never vanishes.
  const { byProject, looseThreads } = useMemo(() => {
    const knownProjects = new Set<string>(
      projects.map((project) => project.id),
    );
    const grouped = new Map<string, ChatThreadSummary[]>();
    const loose: ChatThreadSummary[] = [];
    for (const thread of threads) {
      if (
        thread.projectId !== undefined &&
        knownProjects.has(thread.projectId)
      ) {
        const bucket = grouped.get(thread.projectId);
        if (bucket) {
          bucket.push(thread);
        } else {
          grouped.set(thread.projectId, [thread]);
        }
      } else {
        loose.push(thread);
      }
    }
    return { byProject: grouped, looseThreads: loose };
  }, [threads, projects]);

  const setProjectCollapsed = (projectId: string, collapsed: boolean) => {
    setCollapsedProjects((previous) => ({
      ...previous,
      [projectId]: collapsed,
    }));
  };

  // Defined once and reused by both the empty-state and populated headers so
  // the "new project" affordance always lives on the right of the PROJECTS
  // header row. `-mr-1.5` pulls the header actions onto the same vertical
  // axis as the rows' trailing controls.
  const newProjectButton = (
    <Tooltip content={t('newProject')} side="right" contentClassName="py-1.5">
      <Button
        size="icon"
        variant="ghost"
        onClick={() => setCreateProjectOpen(true)}
        aria-label={t('newProject')}
        className="text-muted-foreground -my-1 -mr-1.5 size-7 shrink-0"
      >
        <FolderPlus className="size-4" />
      </Button>
    </Tooltip>
  );

  // The chat search affordance: one icon on the CHATS header that opens the
  // shared ⌘K palette — there is no second search implementation. Absent
  // (not broken) when no sidebar surface exists to open.
  const searchChatButton = sidebar ? (
    <Tooltip content={t('searchChat')} side="right" contentClassName="py-1.5">
      <Button
        size="icon"
        variant="ghost"
        onClick={() => sidebar.setSearchOpen(true)}
        aria-label={t('searchChat')}
        className="text-muted-foreground -my-1 -mr-1.5 size-7 shrink-0"
      >
        <Search className="size-4" />
      </Button>
    </Tooltip>
  ) : undefined;

  // Wait for BOTH async sections (threads + project folders) before swapping
  // the skeleton for real content, so project rows never pop in after first
  // paint. The skeleton is the same geometry the boot shell masks with.
  const showSkeleton = !available || projectsQuery.status === 'loading';
  const isEmpty = threads.length === 0 && sortedProjects.length === 0;

  return (
    <Stack gap={0} className="min-h-0 flex-1 px-2.5 pt-2.5 pb-3.5">
      <Stack gap={0} className="min-h-0 flex-1 gap-0.5 overflow-y-auto">
        {showSkeleton ? (
          <ChatHistorySkeleton />
        ) : isEmpty ? (
          <>
            <SubPanelSectionHeader
              label={t('projectsSection')}
              action={newProjectButton}
            />
            <Stack
              gap={1}
              align="center"
              justify="center"
              className="px-6 py-10 text-center"
            >
              <MessageSquareDashed
                className="text-muted-foreground/60 mb-1 size-8"
                aria-hidden
              />
              <Text
                as="div"
                variant="muted"
                className="text-foreground font-medium text-nowrap"
              >
                {t('history.empty')}
              </Text>
              <Text as="div" variant="caption" className="text-nowrap">
                {t('history.emptySubtitle')}
              </Text>
            </Stack>
          </>
        ) : (
          <ThreadDndProvider organizationId={organizationId}>
            {/* PROJECTS — always rendered (even empty) so the section never
                appears/disappears on drag and the "new project" action always
                has a home. Each folder is a drop target. */}
            <SubPanelSectionHeader
              sticky
              label={t('projectsSection')}
              action={newProjectButton}
            />
            {sortedProjects.map((project) => (
              <ProjectFolder
                key={project.id}
                project={project}
                organizationId={organizationId}
                threads={byProject.get(project.id) ?? []}
                activeThreadId={activeThreadId}
                explicitCollapsed={collapsedProjects[project.id]}
                onSetCollapsed={(collapsed) =>
                  setProjectCollapsed(project.id, collapsed)
                }
              />
            ))}

            {/* CHATS — loose chats not filed under any project. Also a drop
                target: a chat dragged here (from a project) is moved back out
                to "Chats". Always rendered so that target exists even when
                every chat currently lives in a project. */}
            <div aria-hidden className="border-border mt-1.5 mb-2 border-t" />
            <SubPanelSectionHeader
              sticky
              label={t('chatsSection')}
              action={searchChatButton}
            />
            <LooseThreadsDropZone hasThreads={looseThreads.length > 0}>
              {looseThreads.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  organizationId={organizationId}
                  activeThreadId={activeThreadId}
                />
              ))}
            </LooseThreadsDropZone>
          </ThreadDndProvider>
        )}
      </Stack>

      {/* Mounted on demand so a render without the app's data providers (a
          component test) never runs the dialog's mutation hooks. */}
      {createProjectOpen && (
        <ProjectCreateDialog
          open={createProjectOpen}
          onOpenChange={setCreateProjectOpen}
          organizationId={organizationId}
          // A freshly created project opens expanded so it's ready to receive
          // chats; the persisted state keeps that across the navigation the
          // dialog performs to the new project page.
          onCreated={(projectId) => setProjectCollapsed(projectId, false)}
        />
      )}
    </Stack>
  );
}

function ProjectFolder({
  project,
  organizationId,
  threads,
  activeThreadId,
  explicitCollapsed,
  onSetCollapsed,
}: {
  project: ChatProjectSummary;
  organizationId: string;
  threads: readonly ChatThreadSummary[];
  activeThreadId?: string;
  /** Persisted user choice for this folder; `undefined` until toggled. */
  explicitCollapsed?: boolean;
  onSetCollapsed: (collapsed: boolean) => void;
}) {
  const { t } = useT('chat');
  const navigate = useNavigate();
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
              <ThreadRow
                key={thread.id}
                thread={thread}
                organizationId={organizationId}
                activeThreadId={activeThreadId}
              />
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
function LooseThreadsDropZone({
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

function ThreadRow({
  thread,
  organizationId,
  activeThreadId,
}: {
  thread: ChatThreadSummary;
  organizationId: string;
  activeThreadId?: string;
}) {
  const { t } = useT('chat');
  const active = thread.id === activeThreadId;
  const { setNodeRef, listeners, isDragging } = useThreadDraggable({
    id: thread.id,
    projectId: thread.projectId ?? null,
    title: thread.title ?? t('history.untitled'),
  });
  const treatment = useSubPanelRowTreatment(active && !isDragging);

  return (
    <li
      ref={setNodeRef}
      {...listeners}
      data-thread-id={thread.id}
      className={cn(
        'group relative flex items-center rounded-md',
        // The lifted copy travels in the drag overlay; the source row stays
        // behind as a faded placeholder so it is never read as the active row.
        isDragging && 'opacity-40',
      )}
    >
      <Link
        to="/dashboard/$id/chat/$threadId"
        params={{ id: organizationId, threadId: thread.id }}
        aria-current={active ? 'page' : undefined}
        className={cn(
          SUB_PANEL_ROW_CLASS,
          'min-w-0 flex-1 gap-1.5',
          treatment.className,
        )}
        {...(treatment.style !== undefined ? { style: treatment.style } : {})}
      >
        {thread.kind === 'sandbox' && (
          <Boxes
            aria-label={t('sandbox.label')}
            className="size-3.5 shrink-0"
          />
        )}
        <span className="truncate leading-snug">
          {thread.title ?? t('history.untitled')}
        </span>
        {thread.generating && (
          <span className="text-muted-foreground ml-auto shrink-0 text-xs">
            {t('history.generating')}
          </span>
        )}
      </Link>
      {/* On desktop the share menu is an absolute overlay so it reserves no
          horizontal space until hover — the title gets the full width. On
          touch it stays in-flow and always visible. */}
      <div className="bg-background/80 z-10 shrink-0 rounded-md opacity-100 backdrop-blur-sm transition-opacity md:absolute md:top-1/2 md:right-1 md:-translate-y-1/2 md:opacity-0 md:group-hover:opacity-100 md:has-[[data-state=open]]:opacity-100">
        <ThreadShareMenu organizationId={organizationId} thread={thread} />
      </div>
    </li>
  );
}
