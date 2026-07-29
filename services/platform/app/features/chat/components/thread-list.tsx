'use client';

/**
 * The chat sub-panel: the org's project folders, every active thread the user
 * can open (newest first, pinned floated on top by the server), and the
 * archived drawer pinned underneath — built from the same sub-panel list
 * vocabulary the settings rail uses, so the two panels read as siblings.
 *
 * This file owns the sections and the data flow; the row, folder, and
 * archived-drawer presentations live in their own files and read the shared
 * list frame (org, active thread, projects) from context instead of having it
 * threaded through every level.
 *
 * Filing is drag-and-drop AND a row-menu action: every project folder is a
 * drop target, the loose CHATS section is one too, and the row's More-actions
 * menu offers the same move for keyboard users. New chat lives on the nav
 * rail, not here.
 */

import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import {
  FolderPlus,
  MessageCirclePlus,
  MessageSquareDashed,
  Search,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { useOptionalSidebar } from '@/app/components/layout/app-sidebar/sidebar-context';
import {
  ChatRowsSkeleton,
  ProjectRowsSkeleton,
} from '@/app/components/layout/chat-history-skeleton';
import { SubPanelSectionHeader } from '@/app/components/layout/sub-panel-list';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { ProjectCreateDialog } from '@/app/features/projects/components/project-create-dialog';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useT } from '@/lib/i18n/client';

import { useChatProjects, useThreadHolds } from '../data/chat-backend';
import type { ChatProjectSummary, ChatThreadSummary } from '../types';
import { ArchivedSection } from './archived-section';
import { ProjectFolder, LooseThreadsDropZone } from './project-folder';
import { ThreadDndProvider } from './thread-dnd';
import {
  ThreadListFrameProvider,
  type ThreadListFrame,
} from './thread-list-context';
import { ThreadRow } from './thread-row';

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

export const ThreadList = memo(function ThreadList({
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

  const navigate = useNavigate();
  const projectsQuery = useChatProjects(organizationId);
  const projects =
    projectsQuery.status === 'ready' ? projectsQuery.data : NO_PROJECTS;

  // One bulk holds read for the whole panel; while it loads, nothing reads
  // as held (the server still enforces every hold on the mutation).
  const holdsQuery = useThreadHolds(organizationId);
  const orgHeld =
    holdsQuery.status === 'ready' ? holdsQuery.data.orgHeld : false;
  // Keyed on the snapshot's own array (stable while the watch is unchanged),
  // not the wrapper object, so the Set — and the frame below — keep identity
  // across unrelated re-renders.
  const heldIds =
    holdsQuery.status === 'ready' ? holdsQuery.data.targetIds : undefined;
  const heldThreadIds = useMemo(() => new Set(heldIds ?? []), [heldIds]);

  const frame = useMemo<ThreadListFrame>(
    () => ({
      organizationId,
      activeThreadId,
      projects,
      orgHeld,
      heldThreadIds,
    }),
    [organizationId, activeThreadId, projects, orgHeld, heldThreadIds],
  );

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

  // The CHATS header's actions: search (the shared ⌘K palette — there is no
  // second search implementation; absent when no sidebar surface exists to
  // open) and, to its right, starting a fresh conversation.
  const chatHeaderActions = (
    <div className="flex shrink-0 items-center justify-end">
      {sidebar && (
        <Tooltip
          content={t('searchChat')}
          side="right"
          contentClassName="py-1.5"
        >
          <Button
            size="icon"
            variant="ghost"
            onClick={() => sidebar.setSearchOpen(true)}
            aria-label={t('searchChat')}
            className="text-muted-foreground -my-1 size-7 shrink-0"
          >
            <Search className="size-4" />
          </Button>
        </Tooltip>
      )}
      <Tooltip content={t('newChat')} side="right" contentClassName="py-1.5">
        <Button
          size="icon"
          variant="ghost"
          onClick={() =>
            void navigate({
              to: '/dashboard/$id/chat',
              params: { id: organizationId },
            })
          }
          aria-label={t('newChat')}
          className="text-muted-foreground -my-1 -mr-1.5 size-7 shrink-0"
        >
          <MessageCirclePlus className="size-4" />
        </Button>
      </Tooltip>
    </div>
  );

  // Each async section masks only ITS OWN rows — the section headers, the
  // "new project" and search affordances, and the divider are known at mount
  // and render real immediately, so loading reveals the panel granularly
  // instead of holding one whole-panel mask. The row masks reuse the boot
  // shell's exact geometry, so each reveal is a mask swap, not a layout
  // change.
  const projectsLoading = projectsQuery.status === 'loading';
  const threadsLoading = !available;
  const isEmpty =
    !projectsLoading &&
    !threadsLoading &&
    threads.length === 0 &&
    sortedProjects.length === 0;

  return (
    <ThreadListFrameProvider value={frame}>
      <Stack gap={0} className="min-h-0 flex-1 px-2.5 pt-2.5 pb-3.5">
        <ThreadDndProvider organizationId={organizationId}>
          <Stack gap={0} className="min-h-0 flex-1 gap-0.5 overflow-y-auto">
            {/* PROJECTS — always rendered (even empty) so the section never
                appears/disappears on drag and the "new project" action always
                has a home. Each folder is a drop target. */}
            <SubPanelSectionHeader
              sticky
              label={t('projectsSection')}
              action={newProjectButton}
            />
            {projectsLoading ? (
              <Skeletonize loading className="flex shrink-0 flex-col gap-0.5">
                <ProjectRowsSkeleton />
              </Skeletonize>
            ) : (
              sortedProjects.map((project) => (
                <ProjectFolder
                  key={project.id}
                  project={project}
                  threads={byProject.get(project.id) ?? []}
                  explicitCollapsed={collapsedProjects[project.id]}
                  onSetCollapsed={(collapsed) =>
                    setProjectCollapsed(project.id, collapsed)
                  }
                />
              ))
            )}

            {isEmpty ? (
              // Both sections answered and both are empty: one combined hint
              // replaces the CHATS section entirely — a "Chats" header over
              // nothing would read as a second, redundant empty state.
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
            ) : (
              <>
                {/* CHATS — loose chats not filed under any project. Also a
                    drop target: a chat dragged here (from a project) is moved
                    back out to "Chats". Always rendered so that target exists
                    even when every chat currently lives in a project. */}
                <div
                  aria-hidden
                  className="border-border mt-1.5 mb-2 border-t"
                />
                <SubPanelSectionHeader
                  sticky
                  label={t('chatsSection')}
                  action={chatHeaderActions}
                />
                {threadsLoading ? (
                  <Skeletonize
                    loading
                    className="flex shrink-0 flex-col gap-0.5"
                  >
                    <ChatRowsSkeleton />
                  </Skeletonize>
                ) : (
                  <LooseThreadsDropZone hasThreads={looseThreads.length > 0}>
                    {looseThreads.map((thread) => (
                      <ThreadRow key={thread.id} thread={thread} />
                    ))}
                  </LooseThreadsDropZone>
                )}
              </>
            )}
          </Stack>

          {/* ARCHIVED — pinned under the scroller, outside it, so the drawer
              is reachable however long the active list grows. */}
          <ArchivedSection />
        </ThreadDndProvider>

        {/* Mounted on demand so a render without the app's data providers (a
            component test) never runs the dialog's mutation hooks. */}
        {createProjectOpen && (
          <ProjectCreateDialog
            open={createProjectOpen}
            onOpenChange={setCreateProjectOpen}
            organizationId={organizationId}
            // A freshly created project opens expanded so it's ready to
            // receive chats; the persisted state keeps that across the
            // navigation the dialog performs to the new project page.
            onCreated={(projectId) => setProjectCollapsed(projectId, false)}
          />
        )}
      </Stack>
    </ThreadListFrameProvider>
  );
});
