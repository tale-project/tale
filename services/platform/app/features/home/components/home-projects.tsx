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
import { SlidingHighlight } from '@tale/ui/section-nav';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { SubPanelDisclosureBody } from '@tale/ui/sub-panel-list';
import { Tooltip } from '@tale/ui/tooltip';
import { useSlidingIndicator } from '@tale/ui/use-sliding-indicator';
import { toast } from '@tale/ui/use-toast';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  defaultRangeExtractor,
  type Range,
  useVirtualizer,
} from '@tanstack/react-virtual';
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
  Fragment,
  memo,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { ProjectRowsSkeleton } from '@/app/components/layout/home-panel-skeleton';
import {
  dropZoneClassName,
  useProjectDropZone,
} from '@/app/features/chat/components/thread-dnd';
import { useProjectPin } from '@/app/features/chat/data/chat-backend';
import type { ChatProjectSummary } from '@/app/features/chat/types';
import { ProjectAvatar } from '@/app/features/projects/components/project-avatar';
import { ProjectCreateDialog } from '@/app/features/projects/components/project-create-dialog';
import { useOffsetInScrollport } from '@/app/features/tasks/components/windowed-task-rows';
import { useAbility } from '@/app/hooks/use-ability';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useT } from '@/lib/i18n/client';

import { moveRowFocus } from '../lib/row-navigation';
import { usePlacementProps } from './home-rows';
import {
  type HomeRowPlacement,
  useRowWindowKeys,
  WINDOWED_STREAM_MIN_ROWS,
  windowSpacing,
  WindowSpacer,
} from './home-stream';

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
  /** Its place in a windowed list of projects. */
  placement?: HomeRowPlacement;
}) {
  const { t } = useT('home');
  const { t: tChat } = useT('chat');
  const navigate = useNavigate();
  const accentColor = useAccentColor();
  const { setNodeRef, isOver } = useProjectDropZone(project.id);
  const { setPinned } = useProjectPin(organizationId);
  const pinned = project.pinnedAt !== undefined;

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

  const placed = usePlacementProps(placement, project.id, setNodeRef);

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

  const sorted = useMemo(
    () =>
      [...projects].sort((a, b) => {
        if (a.pinnedAt !== undefined && b.pinnedAt !== undefined) {
          return b.pinnedAt - a.pinnedAt;
        }
        if (a.pinnedAt !== undefined) return -1;
        if (b.pinnedAt !== undefined) return 1;
        return a.name.localeCompare(b.name, undefined, {
          sensitivity: 'base',
        });
      }),
    [projects],
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
  // The scroller as state too, for the windowed list inside it: a child's
  // layout effect runs before this ref attaches.
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );
  const { containerRef } = indicator;
  const setScrollRefs = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef(node);
      setScrollElement(node);
    },
    [containerRef],
  );
  const renderRow = (
    project: ChatProjectSummary,
    placement?: HomeRowPlacement,
  ) => (
    <HomeProjectRow
      key={project.id}
      organizationId={organizationId}
      project={project}
      active={project.id === highlightedId}
      {...(scope !== undefined ? { scope } : {})}
      {...(placement !== undefined ? { placement } : {})}
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
          ref={setScrollRefs}
          className="scrollbar-thin relative max-h-full overflow-y-auto"
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
          ) : sorted.length > WINDOWED_PROJECTS_MIN_ROWS ? (
            <WindowedProjectRows
              projects={sorted}
              scrollElement={scrollElement}
              activeId={highlightedId ?? null}
              renderRow={renderRow}
            />
          ) : (
            <ul
              role="list"
              onKeyDown={moveRowFocus}
              className="flex flex-col gap-0.5 py-0.5"
            >
              {sorted.map((project) => renderRow(project))}
            </ul>
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

/**
 * More projects than this mount only the rows near the section's view; a
 * shorter list mounts every row, so find in page and a screen reader's
 * browse mode keep reaching all of them. The Home stream draws the line at
 * the same count.
 */
const WINDOWED_PROJECTS_MIN_ROWS = WINDOWED_STREAM_MIN_ROWS;
/** A project row's `h-8` and the list's `gap-0.5` and `py-0.5`. */
const PROJECT_ROW_HEIGHT = 32;
const PROJECT_ROW_GAP = 2;
const PROJECT_LIST_PADDING = { start: 2, end: 2 };
const PROJECT_OVERSCAN = 8;

/**
 * A long PROJECTS list, windowed like the Home stream (`home-stream.tsx`):
 * the rows near the view are mounted, spacers stand in for the others, and
 * the open project's row, a focused row and the first and last rows stay
 * mounted wherever the list scrolls. A row's drop zone exists while it is
 * mounted, and dnd-kit scrolls the list as a dragged chat nears its edge,
 * which mounts the rows it reaches.
 */
function WindowedProjectRows({
  projects,
  scrollElement,
  activeId,
  renderRow,
}: {
  projects: readonly ChatProjectSummary[];
  scrollElement: HTMLElement | null;
  activeId: string | null;
  renderRow: (
    project: ChatProjectSummary,
    placement?: HomeRowPlacement,
  ) => ReactNode;
}) {
  const [listElement, setListElement] = useState<HTMLUListElement | null>(null);
  const scrollMargin = useOffsetInScrollport(listElement, scrollElement);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);
  const onFocusWithin = useCallback((key: string, within: boolean) => {
    setFocusedKey((current) =>
      within ? key : current === key ? null : current,
    );
  }, []);
  const rowKeys = useMemo(
    () => projects.map((project) => project.id),
    [projects],
  );
  const indexByKey = useMemo(
    () => new Map(rowKeys.map((key, index) => [key, index])),
    [rowKeys],
  );
  const pinned = useMemo(() => {
    const indexes = new Set<number>([0, projects.length - 1]);
    for (const key of [activeId, focusedKey, pendingFocusKey]) {
      const index = key === null ? undefined : indexByKey.get(key);
      if (index !== undefined) indexes.add(index);
    }
    return indexes;
  }, [projects.length, activeId, focusedKey, pendingFocusKey, indexByKey]);
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = new Set(defaultRangeExtractor(range));
      for (const index of pinned) {
        if (index >= 0 && index < range.count) indexes.add(index);
      }
      return [...indexes].sort((a, b) => a - b);
    },
    [pinned],
  );
  const virtualizer = useVirtualizer<HTMLElement, HTMLLIElement>({
    count: projects.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => PROJECT_ROW_HEIGHT,
    getItemKey: (index) => projects[index]?.id ?? index,
    gap: PROJECT_ROW_GAP,
    paddingStart: PROJECT_LIST_PADDING.start,
    paddingEnd: PROJECT_LIST_PADDING.end,
    overscan: PROJECT_OVERSCAN,
    scrollMargin,
    initialRect: { width: 280, height: 360 },
    rangeExtractor,
  });
  const handleKeyDown = useRowWindowKeys({
    listElement,
    rowKeys,
    indexByKey,
    virtualizer,
    pendingFocusKey,
    setPendingFocusKey,
  });
  const { measureElement } = virtualizer;
  const placements = useMemo(
    () =>
      new Map(
        projects.map((project, index) => [
          project.id,
          {
            measureRef: measureElement,
            index,
            position: index + 1,
            size: projects.length,
            onFocusWithin,
          },
        ]),
      ),
    [projects, measureElement, onFocusWithin],
  );

  const items = virtualizer.getVirtualItems();
  const spacing = windowSpacing(
    items,
    projects.length,
    virtualizer.getTotalSize(),
    scrollMargin,
    PROJECT_ROW_GAP,
    PROJECT_LIST_PADDING,
  );
  return (
    <ul
      ref={setListElement}
      role="list"
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-0.5 py-0.5"
    >
      {items.map((item, position) => {
        const project = projects[item.index];
        if (project === undefined) return null;
        const space = spacing.before[position] ?? 0;
        return (
          <Fragment key={project.id}>
            {space > 0 && <WindowSpacer height={space} />}
            {renderRow(project, placements.get(project.id))}
          </Fragment>
        );
      })}
      {spacing.after > 0 && <WindowSpacer height={spacing.after} />}
    </ul>
  );
}
