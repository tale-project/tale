'use client';

/**
 * The Home panel's PROJECTS section: one row per project, each a door into
 * the project (its board, files and chats open beside the panel) and a drop
 * target — drag a chat onto a project to file it there. Pinned projects lead,
 * the rest read alphabetically, and the section keeps at most half the panel
 * so the stream below always stays in reach.
 *
 * On a phone Home is a screen, not a panel beside the project, so a row there
 * narrows the stream to that project instead (`scope`); the project's page is
 * one labelled step away from the scope bar. That screen creates nothing, so
 * it carries no New project or New chat.
 */

import { useAccentColor } from '@tale/ui/accent-color';
import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { lazyComponent } from '@tale/ui/lazy-component';
import { SlidingHighlight } from '@tale/ui/section-nav';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { SubPanelDisclosureBody } from '@tale/ui/sub-panel-list';
import { Tooltip } from '@tale/ui/tooltip';
import { useSlidingIndicator } from '@tale/ui/use-sliding-indicator';
import { toast } from '@tale/ui/use-toast';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ChevronRight,
  FolderOpen,
  FolderPlus,
  LayoutList,
  MoreHorizontal,
  Pin,
  PinOff,
  SquarePen,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useMemo,
  useState,
  type ComponentProps,
} from 'react';

import { ProjectRowsSkeleton } from '@/app/components/layout/home-panel-skeleton';
import {
  dropZoneClassName,
  useProjectDropZone,
} from '@/app/features/chat/components/thread-dnd';
import { useProjectPin } from '@/app/features/chat/data/chat-backend';
import type { ChatProjectSummary } from '@/app/features/chat/types';
import { ProjectAvatar } from '@/app/features/projects/components/project-avatar';
import type { ProjectCreateDialog as ProjectCreateDialogComponent } from '@/app/features/projects/components/project-create-dialog';
import { useAbility } from '@/app/hooks/use-ability';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useT } from '@/lib/i18n/client';

import { usePlacementProps } from './home-rows';
import {
  HomeWindowedList,
  type HomeListEntry,
  type HomeRowPlacement,
} from './home-stream';

/**
 * The dialog New project opens loads the first time it opens, not with Home:
 * it brings the project form and its identity picker. Pointing at the button
 * starts the load, so a click mostly finds it there.
 */
const loadProjectCreateDialog = () =>
  import('@/app/features/projects/components/project-create-dialog');
const ProjectCreateDialog = lazyComponent<
  ComponentProps<typeof ProjectCreateDialogComponent>
>(() =>
  loadProjectCreateDialog().then((module) => ({
    default: module.ProjectCreateDialog,
  })),
);
function warmProjectCreateDialog() {
  loadProjectCreateDialog().catch((error: unknown) => {
    // Opening the dialog loads it again, and says so if it still fails.
    console.warn('[home] the project dialog did not load ahead', error);
  });
}

/** How a row behaves on a phone: a toggle that narrows the stream. */
export interface HomeProjectScope {
  /** The project the stream is narrowed to, if any. */
  readonly projectId: string | undefined;
  readonly onChange: (projectId: string | undefined) => void;
}

const HomeProjectRow = memo(function HomeProjectRow({
  organizationId,
  project,
  active,
  scope,
  placement,
}: {
  organizationId: string;
  project: ChatProjectSummary;
  active: boolean;
  scope?: HomeProjectScope;
  placement?: HomeRowPlacement;
}) {
  const { t } = useT('home');
  const { t: tChat } = useT('chat');
  const navigate = useNavigate();
  const accentColor = useAccentColor();
  const { setNodeRef, isOver } = useProjectDropZone(project.id);
  const { setPinned } = useProjectPin(organizationId);
  const pinned = project.pinnedAt !== undefined;
  const placed = usePlacementProps(placement, project.id, setNodeRef);

  const menuItems: DropdownMenuGroup[] = [
    [
      ...(scope === undefined
        ? [
            {
              type: 'item' as const,
              label: tChat('newChat'),
              icon: SquarePen,
              onClick: () =>
                void navigate({
                  to: '/dashboard/$id/chat',
                  params: { id: organizationId },
                  search: { projectId: project.id },
                }),
            },
          ]
        : [
            {
              type: 'item' as const,
              label: t('scope.open'),
              icon: FolderOpen,
              onClick: () =>
                void navigate({
                  to: '/dashboard/$id/projects/$projectId',
                  params: { id: organizationId, projectId: project.id },
                }),
            },
          ]),
      {
        type: 'item',
        label: pinned ? tChat('unpinProject') : tChat('pinProject'),
        icon: pinned ? PinOff : Pin,
        onClick: () => {
          setPinned(project.id, !pinned).catch((error: unknown) => {
            console.error('Failed to update project pin:', error);
            toast({ title: tChat('pinFailed'), variant: 'destructive' });
          });
        },
      },
    ],
  ];

  const rowClassName = cn(
    'focus-visible:ring-ring relative z-10 flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
    // The open project's fill is the list's gliding highlight.
    active
      ? 'text-foreground font-medium'
      : 'text-foreground/90 hover:bg-muted/60 hover:text-foreground',
  );
  const rowContent = (
    <>
      <ProjectAvatar
        name={project.name}
        icon={project.icon}
        color={project.color}
        size={16}
      />
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      {pinned && (
        <Pin
          aria-label={tChat('pinned')}
          className="text-muted-foreground size-3 shrink-0 transition-opacity md:group-hover:opacity-0 md:group-has-[:focus-visible]:opacity-0 md:group-has-[[data-state=open]]:opacity-0"
        />
      )}
    </>
  );

  return (
    <li {...placed} className={cn('group relative', dropZoneClassName(isOver))}>
      {scope === undefined ? (
        <Link
          to="/dashboard/$id/projects/$projectId"
          params={{ id: organizationId, projectId: project.id }}
          aria-current={active ? 'page' : undefined}
          data-indicator-key={project.id}
          className={rowClassName}
          {...(active && accentColor ? { style: { color: accentColor } } : {})}
        >
          {rowContent}
        </Link>
      ) : (
        <button
          type="button"
          aria-pressed={active}
          data-indicator-key={project.id}
          onClick={() => scope.onChange(active ? undefined : project.id)}
          className={cn(rowClassName, 'w-full text-left')}
          {...(active && accentColor ? { style: { color: accentColor } } : {})}
        >
          {rowContent}
        </button>
      )}
      <div className="bg-background/85 absolute top-1/2 right-1 z-10 -translate-y-1/2 rounded-md opacity-100 backdrop-blur-sm transition-opacity duration-150 md:opacity-0 md:group-hover:opacity-100 md:group-has-[:focus-visible]:opacity-100 md:has-[[data-state=open]]:opacity-100">
        <DropdownMenu
          align="end"
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground size-6 p-1"
              aria-label={t('projects.actions', { project: project.name })}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          }
          items={menuItems}
        />
      </div>
    </li>
  );
});

export function HomeProjects({
  organizationId,
  projects,
  loading,
  activeProjectId,
  scope,
}: {
  organizationId: string;
  projects: readonly ChatProjectSummary[];
  loading: boolean;
  activeProjectId?: string;
  /** Phone Home: rows narrow the stream instead of opening the project. */
  scope?: HomeProjectScope;
}) {
  const { t } = useT('home');
  const [open, setOpen] = usePersistedState(
    `home-projects-open-${organizationId}`,
    true,
  );
  const [createOpen, setCreateOpen] = useState(false);
  // Creating a project takes the Editor role or higher; the server refuses
  // anyone else, so a Member is not offered the door.
  const canCreate = useAbility().can('write', 'projects');
  const collator = useMemo(
    () => new Intl.Collator(undefined, { sensitivity: 'base' }),
    [],
  );

  const sorted = useMemo(
    () =>
      [...projects].sort((a, b) => {
        if (a.pinnedAt !== undefined && b.pinnedAt !== undefined) {
          return b.pinnedAt - a.pinnedAt;
        }
        if (a.pinnedAt !== undefined) return -1;
        if (b.pinnedAt !== undefined) return 1;
        return collator.compare(a.name, b.name);
      }),
    [projects, collator],
  );
  // The row the highlight rests on: the narrowed project on a phone, the
  // open project's page beside the panel.
  const highlightedId = scope !== undefined ? scope.projectId : activeProjectId;
  // One highlight glides between project rows as the open project changes;
  // the order moves it without changing its key.
  const indicator = useSlidingIndicator<HTMLDivElement>(
    highlightedId ?? null,
    sorted.map((project) => project.id).join(','),
  );
  const entries = useMemo<readonly HomeListEntry<ChatProjectSummary>[]>(
    () =>
      sorted.map((project) => ({
        kind: 'row',
        key: project.id,
        item: project,
      })),
    [sorted],
  );
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );
  const indicatorContainerRef = indicator.containerRef;
  const setScrollerRef = useCallback(
    (node: HTMLDivElement | null) => {
      setScrollElement(node);
      indicatorContainerRef(node);
    },
    [indicatorContainerRef],
  );
  const renderProject = (
    project: ChatProjectSummary,
    placement?: HomeRowPlacement,
  ) => (
    <HomeProjectRow
      key={project.id}
      placement={placement}
      organizationId={organizationId}
      project={project}
      active={project.id === highlightedId}
      {...(scope !== undefined ? { scope } : {})}
    />
  );

  return (
    <section
      aria-label={t('projects.title')}
      className="flex max-h-[45%] min-h-0 shrink-0 flex-col"
    >
      <div className="flex h-7 shrink-0 items-center gap-1 px-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -ml-1 flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-[11px] font-semibold tracking-wider uppercase transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none',
              open && 'rotate-90',
            )}
          />
          <span className="truncate">{t('projects.title')}</span>
          {!open && projects.length > 0 && (
            <span className="text-muted-foreground/70 font-medium tabular-nums">
              {projects.length}
            </span>
          )}
        </button>
        {scope !== undefined ? (
          // A labelled link: the phone has no tooltips, and an icon this
          // small was the only way into the project list.
          <Button
            asChild
            size="sm"
            variant="ghost"
            icon={LayoutList}
            className="text-muted-foreground hover:text-foreground -mr-1 h-7 px-2 text-xs"
          >
            <Link to="/dashboard/$id/projects" params={{ id: organizationId }}>
              {t('projects.allProjects')}
            </Link>
          </Button>
        ) : (
          <>
            <Tooltip content={t('projects.allProjects')} side="bottom">
              <Button
                asChild
                size="icon"
                variant="ghost"
                aria-label={t('projects.allProjects')}
                className="text-muted-foreground hover:text-foreground size-6 p-1"
              >
                <Link
                  to="/dashboard/$id/projects"
                  params={{ id: organizationId }}
                >
                  <LayoutList className="size-3.5" />
                </Link>
              </Button>
            </Tooltip>
            {canCreate && (
              <Tooltip content={t('projects.newProject')} side="bottom">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setCreateOpen(true)}
                  onPointerEnter={warmProjectCreateDialog}
                  onFocus={warmProjectCreateDialog}
                  aria-label={t('projects.newProject')}
                  className="text-muted-foreground hover:text-foreground size-6 p-1"
                >
                  <FolderPlus className="size-3.5" />
                </Button>
              </Tooltip>
            )}
          </>
        )}
      </div>
      <SubPanelDisclosureBody open={open} className="min-h-0">
        <div
          ref={setScrollerRef}
          className={cn(
            'scrollbar-thin relative max-h-full overflow-y-auto',
            !loading && sorted.length > 0 && 'py-0.5',
          )}
        >
          <SlidingHighlight indicator={indicator} />
          {loading ? (
            <Skeletonize loading className="flex flex-col gap-0.5 py-0.5">
              <ProjectRowsSkeleton />
            </Skeletonize>
          ) : sorted.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">
              {t('projects.empty')}
            </p>
          ) : (
            <HomeWindowedList
              as="ul"
              entries={entries}
              scrollElement={scrollElement}
              activeKey={highlightedId ?? null}
              rowEstimate={32}
              rowGap={2}
              measurementsPaused={!open}
              renderRow={renderProject}
            />
          )}
        </div>
      </SubPanelDisclosureBody>
      {canCreate && scope === undefined && createOpen && (
        <ProjectCreateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          organizationId={organizationId}
        />
      )}
    </section>
  );
}
