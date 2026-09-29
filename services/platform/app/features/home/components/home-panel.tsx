'use client';

/**
 * The Home panel — one list for everything you work on.
 *
 * Chats, the tasks assigned to you and the inbox's customer conversations
 * used to live in three sections with three different shapes (a chat list,
 * a project board, a mail client). Here they share one stream, one row
 * anatomy and one set of time bands; the switcher narrows the stream to one
 * kind when that is all you want. Projects sit above the stream as doors
 * (their board, files and chats open beside the panel) and as drop targets
 * for filing chats.
 *
 * The panel stays mounted across every Home route, so moving from a chat to
 * a task to a conversation never swaps the navigation out from under you.
 */

import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { FilterPanel, type FilterConfig } from '@tale/ui/filters/filter-panel';
import { SearchInput } from '@tale/ui/search-input';
import { SlidingHighlight } from '@tale/ui/section-nav';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { SubPanel } from '@tale/ui/sub-panel';
import { Tooltip } from '@tale/ui/tooltip';
import { useIsMac } from '@tale/ui/use-is-mac';
import { useResizable } from '@tale/ui/use-resizable';
import { useSlidingIndicator } from '@tale/ui/use-sliding-indicator';
import { Link, useLocation } from '@tanstack/react-router';
import {
  Inbox,
  ListChecks,
  MessageSquareDashed,
  SquarePen,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

import { TOOLTIP_SHORTCUT_CLASS } from '@/app/components/layout/app-sidebar/sidebar-motion';
import { HomeRowsSkeleton } from '@/app/components/layout/home-panel-skeleton';
import { ArchivedSection } from '@/app/features/chat/components/archived-section';
import {
  ThreadDndProvider,
  useStayDropZone,
  useThreadDndState,
} from '@/app/features/chat/components/thread-dnd';
import {
  ThreadListFrameProvider,
  type ThreadListFrame,
} from '@/app/features/chat/components/thread-list-context';
import { useThreadHolds } from '@/app/features/chat/data/chat-backend';
import type { TaskStatus } from '@/app/features/tasks/lib/display';
import { useClockOffset } from '@/app/hooks/use-clock-offset';
import { useCurrentUser } from '@/app/hooks/use-current-user';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useT } from '@/lib/i18n/client';

import { useEnteringKeys } from '../hooks/use-entering-keys';
import { useHomeData } from '../hooks/use-home-data';
import { hasDraft, homeDraftKey } from '../lib/home-drafts';
import {
  DRAFT_ROW_KEY,
  HOME_VIEWS,
  INBOX_STATUSES,
  groupHomeItems,
  homeItemKey,
  viewIncludes,
  type HomeItem,
  type HomeView,
  type InboxStatus,
} from '../lib/home-items';
import {
  isPanelCollapsible,
  readHomeLocation,
  type HomeLocation,
} from '../lib/home-paths';
import { adjacentRow, moveRowFocus } from '../lib/row-navigation';
import { HomeInboxList } from './home-inbox-list';
import { useHomePanel } from './home-panel-context';
import { HomeProjects } from './home-projects';
import {
  HomeChatRow,
  HomeConversationRow,
  HomeDraftChatRow,
  HomeTaskRow,
} from './home-rows';
import { HomeViewSwitcher } from './home-view-switcher';

const SEARCH_PLACEHOLDER_KEY: Record<HomeView, string> = {
  all: 'groups.searchPlaceholderAll',
  chats: 'groups.searchPlaceholderChats',
  tasks: 'groups.searchPlaceholderTasks',
  inbox: 'inbox.searchPlaceholder',
};

function isHomeView(value: unknown): value is HomeView {
  return HOME_VIEWS.some((view) => view === value);
}

function isInboxStatus(value: unknown): value is InboxStatus {
  return INBOX_STATUSES.some((status) => status === value);
}

function isActive(item: HomeItem, location: HomeLocation): boolean {
  if (item.kind === 'chat') {
    return location.kind === 'chat' && location.threadId === item.id;
  }
  if (item.kind === 'task') {
    return location.kind === 'task' && location.taskId === item.id;
  }
  return (
    location.kind === 'conversation' && location.conversationId === item.id
  );
}

const NO_HELD = new Set<string>();

/**
 * The desktop Home panel: the navigator in the shared section-panel frame,
 * beside every Home route. Home needs no header naming it — the panel opens
 * straight on the view switcher, with **New chat** beside it. It folds to
 * nothing when hidden — the inner column keeps its width, so the fold is a
 * clip, not a reflow.
 */
export function HomePanel({ organizationId }: { organizationId: string }) {
  const { t } = useT('home');
  const {
    open: storedOpen,
    setOpen: setStoredOpen,
    setMounted,
  } = useHomePanel();
  const { pathname, search } = useLocation();
  // Only a conversation-shaped page (a chat, a task, an open conversation)
  // carries the toggle in its header, so only there may the panel fold away;
  // everywhere else in Home it stays, or it could not be brought back.
  const collapsible = isPanelCollapsible(
    readHomeLocation(pathname, search, organizationId),
  );
  const open = storedOpen || !collapsible;
  const panelRef = useRef<HTMLDivElement>(null);
  const [storedWidth, setWidth] = usePersistedState(
    `home-panel-width-${organizationId}`,
    280,
  );
  const width =
    typeof storedWidth === 'number' && Number.isFinite(storedWidth)
      ? Math.min(480, Math.max(280, storedWidth))
      : 280;
  const resize = useResizable(panelRef, {
    edge: 'right',
    minWidth: 280,
    maxWidth: 480,
    width,
    onWidthChange: setWidth,
  });
  // ⌘\ (Ctrl+\) folds and unfolds the panel wherever the header's toggle
  // could — the physical key too, for layouts that type "\" with Option.
  const isMac = useIsMac();
  useEffect(() => {
    if (!collapsible) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(isMac ? event.metaKey : event.ctrlKey)) return;
      if (event.key !== '\\' && event.code !== 'Backslash') return;
      event.preventDefault();
      setStoredOpen((previous) => !previous);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [collapsible, isMac, setStoredOpen]);
  // Tells the page's panel toggle that there is a panel to point at.
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, [setMounted]);
  // Mirrors the panel's state onto `<html>` for the boot-shell placeholders
  // (index.html sets the same class before first paint), so a placeholder
  // rendered after a toggle or an org switch matches what is on screen.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('boot-home-panel-open', open);
    return () => {
      root.classList.remove('boot-home-panel-open');
    };
  }, [open]);
  return (
    <SubPanel
      as="nav"
      width="list"
      ariaLabel={t('aria.panel')}
      id="home-panel"
      style={{ width: open ? width : 0 }}
      className={cn(
        'relative motion-reduce:transition-none',
        !resize.isResizing && '[transition:width_260ms_var(--ease-out-quint)]',
        !open && 'w-0 border-r-0',
      )}
    >
      <div
        ref={panelRef}
        style={{ width }}
        inert={!open || undefined}
        aria-hidden={!open}
        className="flex h-full shrink-0 flex-col overflow-hidden"
      >
        <HomeNavigator
          organizationId={organizationId}
          switcherAction={<HomeNewChatButton organizationId={organizationId} />}
        />
      </div>
      {open && (
        <div
          role="separator"
          tabIndex={0}
          aria-label={t('aria.panel')}
          aria-controls="home-panel"
          aria-orientation="vertical"
          aria-valuemin={resize.minWidth}
          aria-valuemax={resize.maxWidth}
          aria-valuenow={width}
          onMouseDown={resize.handleMouseDown}
          onKeyDown={resize.handleKeyDown}
          className="hover:bg-primary/30 focus-visible:bg-primary/30 focus-visible:ring-ring absolute inset-y-0 right-0 w-1.5 cursor-col-resize focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
        />
      )}
    </SubPanel>
  );
}

/**
 * Everything Home lists — the view switcher, the projects, and the stream of
 * chats, tasks and conversations (or the Inbox view's tools). The desktop
 * panel frames it beside the page; on a phone it is the Home screen itself.
 */
export function HomeNavigator({
  organizationId,
  switcherAction,
  variant = 'panel',
}: {
  organizationId: string;
  /** Beside the view switcher: the desktop panel's New chat. A phone keeps
   * New chat inside its Chats view instead. */
  switcherAction?: ReactNode;
  /** `panel` is the desktop navigator beside the page: projects open their
   * page. `screen` is the phone's Home: projects narrow the stream, and
   * New chat lives in the Chats view only. */
  variant?: 'panel' | 'screen';
}) {
  const { t } = useT('home');
  const { pathname, search: locationSearch } = useLocation();
  const location = readHomeLocation(pathname, locationSearch, organizationId);

  // ⌥↑/⌥↓ open the previous or next item of the list on screen from
  // anywhere but a text field — through chats, tasks and conversations
  // without reaching for the panel, even while it is folded away.
  const navigatorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const root = navigatorRef.current;
      if (root === null) return;
      const row = adjacentRow(event, root);
      if (row === null) return;
      event.preventDefault();
      row.click();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const [storedView, setView] = usePersistedState<HomeView>(
    `home-view-${organizationId}`,
    'all',
  );
  const [storedInboxStatus, setInboxStatus] = usePersistedState<InboxStatus>(
    `home-inbox-status-${organizationId}`,
    'open',
  );
  // On an inbox route the URL's status wins, so the Inbox view shows the tab
  // the open conversation lives in; the remembered one is checked like the
  // view, since storage may hold anything.
  const inboxStatus: InboxStatus =
    location.kind === 'conversation' && isInboxStatus(location.status)
      ? location.status
      : isInboxStatus(storedInboxStatus)
        ? storedInboxStatus
        : 'open';

  // The project a phone's stream is narrowed to ('' = none). A project that
  // has since been deleted stops narrowing, since storage may hold anything.
  const [storedScope, setScope] = usePersistedState<string>(
    `home-scope-${organizationId}`,
    '',
  );

  const { t: tChat } = useT('chat');
  const { t: tTasks } = useT('tasks');

  const [chatArchivedFilter, setChatArchivedFilter] = useState(false);
  const [taskStatusFilter, setTaskStatusFilter] = useState<TaskStatus[]>([
    'backlog',
    'todo',
    'in_progress',
    'in_review',
  ]);
  const [taskPriorityFilter, setTaskPriorityFilter] = useState<string[]>([]);

  const data = useHomeData(organizationId, {
    includeArchivedChats: chatArchivedFilter,
    taskStatuses: taskStatusFilter.length > 0 ? taskStatusFilter : undefined,
  });
  const { data: me } = useCurrentUser();
  const myUserId = me?.userId;
  const view: HomeView =
    isHomeView(storedView) && (storedView !== 'inbox' || data.hasInbox)
      ? storedView
      : 'all';

  const chatFilters: FilterConfig[] = useMemo(
    () => [
      {
        key: 'archived',
        title: tChat('archived.title'),
        options: [
          {
            value: 'archived',
            label: t('inbox.status.archived'),
          },
        ],
        selectedValues: chatArchivedFilter ? ['archived'] : [],
        onChange: (values) =>
          setChatArchivedFilter(values.includes('archived')),
        widensResultSet: true,
      },
    ],
    [chatArchivedFilter, tChat, t],
  );

  const defaultTaskStatuses = useMemo(
    () => ['backlog', 'todo', 'in_progress', 'in_review'],
    [],
  );

  const taskFilters: FilterConfig[] = useMemo(
    () => [
      {
        key: 'status',
        title: tTasks('fields.status'),
        multiSelect: true,
        options: [
          { value: 'backlog', label: tTasks('status.backlog') },
          { value: 'todo', label: tTasks('status.todo') },
          { value: 'in_progress', label: tTasks('status.in_progress') },
          { value: 'in_review', label: tTasks('status.in_review') },
          { value: 'done', label: tTasks('status.done') },
          { value: 'cancelled', label: tTasks('status.cancelled') },
        ],
        selectedValues: taskStatusFilter,
        defaultValues: defaultTaskStatuses,
        onChange: setTaskStatusFilter,
        widensResultSet: taskStatusFilter.some(
          (s) => s === 'done' || s === 'cancelled',
        ),
      },
      {
        key: 'priority',
        title: tTasks('fields.priority'),
        multiSelect: true,
        options: [
          { value: 'p0', label: tTasks('priority.p0') },
          { value: 'p1', label: tTasks('priority.p1') },
          { value: 'p2', label: tTasks('priority.p2') },
          { value: 'p3', label: tTasks('priority.p3') },
          { value: 'none', label: tTasks('priority.none') },
        ],
        selectedValues: taskPriorityFilter,
        defaultValues: [],
        onChange: setTaskPriorityFilter,
      },
    ],
    [taskStatusFilter, taskPriorityFilter, defaultTaskStatuses, tTasks],
  );

  const clearChatFilters = useCallback(() => setChatArchivedFilter(false), []);
  const clearTaskFilters = useCallback(() => {
    setTaskStatusFilter(defaultTaskStatuses);
    setTaskPriorityFilter([]);
  }, [defaultTaskStatuses]);

  // Scope applies on project-filterable views (All, Chats, or Tasks).
  const viewIncludesScope = view !== 'inbox';
  const scopeProject =
    viewIncludesScope && storedScope !== ''
      ? data.projects.find((project) => project.id === storedScope)
      : undefined;
  // While the projects load, the stream already honours the remembered scope
  // rather than flashing everything first.
  const scopeId =
    viewIncludesScope && storedScope !== '' && data.loading.projects
      ? storedScope
      : scopeProject?.id;

  const holdsQuery = useThreadHolds(organizationId);
  const heldIds =
    holdsQuery.status === 'ready' ? holdsQuery.data.targetIds : undefined;
  const heldThreadIds = useMemo(
    () => (heldIds !== undefined ? new Set(heldIds) : NO_HELD),
    [heldIds],
  );
  const frame = useMemo<ThreadListFrame>(
    () => ({
      organizationId,
      ...(location.kind === 'chat' && location.threadId !== undefined
        ? { activeThreadId: location.threadId }
        : {}),
      projects: data.projects,
      orgHeld: holdsQuery.status === 'ready' ? holdsQuery.data.orgHeld : false,
      heldThreadIds,
    }),
    [organizationId, location, data.projects, holdsQuery, heldThreadIds],
  );

  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();

  const { serverEpochNow } = useClockOffset();
  const now = serverEpochNow();
  const groups = useMemo(
    () =>
      groupHomeItems(
        data.items.filter((item) => {
          if (!viewIncludes(view, item.kind)) return false;
          // The stream keeps only the conversations still open — the
          // closed, spam and archived tabs live in the Inbox view.
          if (item.kind === 'conversation' && item.status !== 'open') {
            return false;
          }
          if (item.kind === 'chat' && !chatArchivedFilter && item.archived) {
            return false;
          }
          if (item.kind === 'task') {
            if (
              taskStatusFilter.length > 0 &&
              !taskStatusFilter.includes(item.status)
            ) {
              return false;
            }
            if (
              taskPriorityFilter.length > 0 &&
              !taskPriorityFilter.includes(item.priority ?? 'none')
            ) {
              return false;
            }
          }
          // A narrowed stream keeps the project's chats and tasks; a
          // conversation belongs to no project.
          if (
            scopeId !== undefined &&
            (item.kind === 'conversation' || item.projectId !== scopeId)
          ) {
            return false;
          }
          if (query === '') return true;

          // Search title
          if (item.title.toLowerCase().includes(query)) return true;

          // Search project name
          if (item.projectId) {
            const project = data.projects.find((p) => p.id === item.projectId);
            if (project && project.name.toLowerCase().includes(query)) {
              return true;
            }
          }

          // Search task identifier (e.g. WEB-12)
          if (item.kind === 'task' && item.identifier) {
            if (item.identifier.toLowerCase().includes(query)) return true;
          }

          // Search conversation contact label / preview
          if (item.kind === 'conversation') {
            if (
              item.contactLabel &&
              item.contactLabel.toLowerCase().includes(query)
            ) {
              return true;
            }
            if (item.preview && item.preview.toLowerCase().includes(query)) {
              return true;
            }
          }

          // Search chat snippet / model name
          if (item.kind === 'chat') {
            const thread = data.threadsById.get(item.id);
            if (thread) {
              if (
                thread.lastMessageSnippet &&
                thread.lastMessageSnippet.toLowerCase().includes(query)
              ) {
                return true;
              }
              if (
                thread.modelName &&
                thread.modelName.toLowerCase().includes(query)
              ) {
                return true;
              }
            }
          }

          return false;
        }),
        now,
      ),
    // `now` moves every render; the bands only need to follow the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.items, view, scopeId, query, data.projects, data.threadsById],
  );

  const scoped = scopeProject !== undefined;
  const streamLoading =
    (viewIncludes(view, 'chat') && data.loading.chats) ||
    (viewIncludes(view, 'task') && data.loading.tasks) ||
    (view === 'inbox' && data.loading.conversations);

  // Keep the open item in sight: when a chat, task or conversation opens
  // from elsewhere (a notification, search, a link), its row scrolls into
  // the stream's view instead of staying highlighted somewhere off-screen.
  const streamRef = useRef<HTMLDivElement>(null);
  const activeKey =
    location.kind === 'chat'
      ? // A fresh chat's draft row is the open item too.
        (location.threadId ?? DRAFT_ROW_KEY)
      : location.kind === 'task'
        ? location.taskId
        : location.kind === 'conversation'
          ? location.conversationId
          : undefined;
  // The row the stream's highlight rests on, in the rows' own keys.
  const highlightKey =
    location.kind === 'chat'
      ? location.threadId !== undefined
        ? homeItemKey({ kind: 'chat', id: location.threadId })
        : DRAFT_ROW_KEY
      : location.kind === 'task'
        ? homeItemKey({ kind: 'task', id: location.taskId })
        : location.kind === 'conversation' &&
            location.conversationId !== undefined
          ? homeItemKey({ kind: 'conversation', id: location.conversationId })
          : null;
  // A fresh chat being written shows as a draft row at the top of the stream.
  const draftingChat =
    location.kind === 'chat' &&
    location.threadId === undefined &&
    viewIncludes(view, 'chat');
  // Once per open item and view: the row may arrive after the first render
  // (the inbox answers after the chats), so each change to the stream looks
  // again until it is found — but a row already revealed is left where the
  // user scrolled it.
  const revealedRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (activeKey === undefined) return;
    const target = `${view}:${activeKey}`;
    if (revealedRef.current === target) return;
    const row = streamRef.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    if (row === null || row === undefined) return;
    revealedRef.current = target;
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeKey, view, streamLoading, groups, draftingChat]);

  const streamLayout = useMemo(
    () =>
      groups
        .map(
          (group) =>
            `${group.key}:${group.items.map((item) => homeItemKey(item)).join(',')}`,
        )
        .join('|'),
    [groups],
  );

  const streamKeys = useMemo(
    () =>
      groups.flatMap((group) => group.items.map((item) => homeItemKey(item))),
    [groups],
  );
  const entering = useEnteringKeys(streamKeys, view, streamLoading);

  const projectsById = useMemo(
    () => new Map(data.projects.map((project) => [project.id, project])),
    [data.projects],
  );

  const searchRecord: Record<string, unknown> = locationSearch;
  const draftProjectId =
    typeof searchRecord.projectId === 'string'
      ? searchRecord.projectId
      : undefined;

  const switcherOptions = [
    { view: 'all' as const, attention: 0 },
    { view: 'chats' as const, attention: data.attention.chats },
    { view: 'tasks' as const, attention: data.attention.tasks },
    ...(data.hasInbox
      ? [{ view: 'inbox' as const, attention: data.attention.inbox }]
      : []),
  ];

  // Unsent text marks its row — not the open one, whose composer is in view.
  const draftFor = (item: HomeItem, active: boolean) =>
    !active && hasDraft(homeDraftKey(item, myUserId, organizationId));

  const renderRow = (item: HomeItem) => {
    const active = isActive(item, location);
    const draft = draftFor(item, active);
    if (item.kind === 'chat') {
      const thread = data.threadsById.get(item.id);
      if (thread === undefined) return null;
      return (
        <HomeChatRow
          key={homeItemKey(item)}
          entering={entering.has(homeItemKey(item))}
          draft={draft}
          item={item}
          thread={thread}
          project={
            item.projectId !== undefined
              ? projectsById.get(item.projectId)
              : undefined
          }
          active={active}
        />
      );
    }
    if (item.kind === 'task') {
      return (
        <HomeTaskRow
          key={homeItemKey(item)}
          entering={entering.has(homeItemKey(item))}
          draft={draft}
          item={item}
          organizationId={organizationId}
          active={active}
        />
      );
    }
    return (
      <HomeConversationRow
        key={homeItemKey(item)}
        entering={entering.has(homeItemKey(item))}
        draft={draft}
        item={item}
        organizationId={organizationId}
        active={active}
      />
    );
  };

  return (
    // `contents`: the navigator's parts stay children of the frame's flex
    // column; the wrapper only scopes the list shortcuts.
    <div ref={navigatorRef} className="contents">
      <div className="flex shrink-0 items-center gap-1.5 px-2.5 pt-2.5 pb-2">
        <div className="min-w-0 flex-1">
          <HomeViewSwitcher
            value={view}
            options={switcherOptions}
            onChange={setView}
          />
        </div>
        {switcherAction}
      </div>

      {view === 'inbox' ? (
        <HomeInboxList
          organizationId={organizationId}
          status={inboxStatus}
          onStatusChange={setInboxStatus}
          onInboxRoute={location.kind === 'conversation'}
          {...(location.kind === 'conversation' &&
          location.conversationId !== undefined
            ? { activeConversationId: location.conversationId }
            : {})}
        />
      ) : (
        <ThreadListFrameProvider value={frame}>
          <ThreadDndProvider organizationId={organizationId}>
            <div className="flex min-h-0 flex-1 flex-col px-2.5">
              {viewIncludesScope && (
                <HomeProjects
                  organizationId={organizationId}
                  projects={data.projects}
                  loading={data.loading.projects}
                  activeProjectId={
                    location.kind === 'project' ? location.projectId : undefined
                  }
                  {...(variant === 'screen'
                    ? {
                        scope: {
                          projectId: scopeId,
                          onChange: (id) => setScope(id ?? ''),
                        },
                      }
                    : {})}
                />
              )}

              {variant === 'screen' && view === 'chats' && (
                <div className="flex shrink-0 items-center justify-between pt-1 pb-1">
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2 text-xs font-medium"
                  >
                    <Link
                      to="/dashboard/$id/chat"
                      params={{ id: organizationId }}
                      search={
                        scopeId !== undefined
                          ? { projectId: scopeId }
                          : { new: true }
                      }
                    >
                      <SquarePen className="size-3.5" />
                      {t('newChat')}
                    </Link>
                  </Button>
                </div>
              )}

              <div className="flex shrink-0 items-center gap-1.5 pt-0.5 pb-1.5">
                <SearchInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t(SEARCH_PLACEHOLDER_KEY[view])}
                  wrapperClassName="min-w-0 flex-1"
                  className="h-8 bg-transparent text-xs shadow-none"
                />
                {view === 'chats' && (
                  <FilterPanel
                    filters={chatFilters}
                    onClearAll={clearChatFilters}
                    align="end"
                    iconOnly
                    compact
                  />
                )}
                {view === 'tasks' && (
                  <FilterPanel
                    filters={taskFilters}
                    onClearAll={clearTaskFilters}
                    align="end"
                    iconOnly
                    compact
                  />
                )}
              </div>

              <HomeStreamScroller
                scrollerRef={streamRef}
                highlightKey={highlightKey}
                showBorder={view !== 'all'}
                layoutVersion={`${view}|${draftingChat ? 'draft|' : ''}${streamLayout}`}
              >
                {streamLoading ? (
                  <Skeletonize loading className="flex flex-col gap-0.5 pt-2">
                    <HomeRowsSkeleton />
                  </Skeletonize>
                ) : groups.length === 0 && !draftingChat ? (
                  <HomeEmpty
                    view={view}
                    organizationId={organizationId}
                    scoped={scoped}
                    showCreate={variant === 'panel'}
                  />
                ) : (
                  <ol
                    // Re-keyed per view, so switching views fades the new
                    // list in instead of swapping rows in place.
                    key={view}
                    aria-label={t('aria.stream')}
                    onKeyDown={moveRowFocus}
                    className="animate-in fade-in-0 flex flex-col gap-1 duration-200 motion-reduce:animate-none"
                  >
                    {draftingChat && (
                      <li>
                        <ul role="list" className="flex flex-col pt-2">
                          <HomeDraftChatRow
                            organizationId={organizationId}
                            {...(draftProjectId !== undefined
                              ? { projectId: draftProjectId }
                              : {})}
                          />
                        </ul>
                      </li>
                    )}
                    {groups.map((group) => (
                      <li key={group.key}>
                        <h3 className="bg-background text-muted-foreground sticky top-0 z-20 px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider uppercase">
                          {t(`groups.${group.key}`)}
                        </h3>
                        <ul role="list" className="flex flex-col gap-px">
                          {group.items.map(renderRow)}
                        </ul>
                      </li>
                    ))}
                  </ol>
                )}
              </HomeStreamScroller>

              {(view === 'all' || view === 'chats') && !scopeId && (
                <ArchivedSection />
              )}
            </div>
          </ThreadDndProvider>
        </ThreadListFrameProvider>
      )}
    </div>
  );
}

/**
 * The stream's scroller, and the place a dragged chat is put back: releasing
 * a row over the stream leaves it where it was, rather than filing it into
 * whichever project or drawer the lifted card grazes.
 */
function HomeStreamScroller({
  scrollerRef,
  highlightKey,
  layoutVersion,
  showBorder = true,
  children,
}: {
  scrollerRef: RefObject<HTMLDivElement | null>;
  /** The open row's key — the one the gliding highlight rests on. */
  highlightKey: string | null;
  /** Changes whenever rows move without the open one changing. */
  layoutVersion: string;
  showBorder?: boolean;
  children: ReactNode;
}) {
  const setDropRef = useStayDropZone();
  // The highlight steps away while a chat is dragged, so the lifted row is
  // not left sitting on a fill; it lands back in place on drop.
  const { isDragging } = useThreadDndState();
  const { containerRef, ...indicator } = useSlidingIndicator<HTMLDivElement>(
    isDragging ? null : highlightKey,
    layoutVersion,
  );
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      scrollerRef.current = node;
      setDropRef(node);
      containerRef(node);
    },
    [scrollerRef, setDropRef, containerRef],
  );
  return (
    <div
      ref={setRefs}
      className={cn(
        'mobile-nav-clearance mobile-nav-inset mobile-nav-scroll scrollbar-thin border-border/70 relative -mx-2.5 mt-2 min-h-0 flex-1 overflow-y-auto px-2.5',
        showBorder && 'border-t',
      )}
    >
      <SlidingHighlight indicator={indicator} />
      {children}
    </div>
  );
}

/** New chat, beside the view switcher: the pencil the rail's Home tile and
 * ⌥⌘N also stand for, its shortcut in the tooltip. */
function HomeNewChatButton({ organizationId }: { organizationId: string }) {
  const { t } = useT('home');
  const isMac = useIsMac();
  const shortcut = isMac ? '⌥ ⌘ N' : 'ALT + CTRL + N';
  return (
    <Tooltip
      content={
        <>
          {t('newChat')}
          <span className={TOOLTIP_SHORTCUT_CLASS}>{shortcut}</span>
        </>
      }
      side="bottom"
    >
      <Button
        asChild
        size="icon"
        variant="ghost"
        aria-label={t('newChat')}
        className="text-muted-foreground hover:text-foreground size-8 shrink-0 transition-transform active:scale-95"
      >
        <Link
          to="/dashboard/$id/chat"
          params={{ id: organizationId }}
          search={{ new: true }}
        >
          <SquarePen className="size-4" />
        </Link>
      </Button>
    </Tooltip>
  );
}

const EMPTY_ICON: Record<HomeView, ReactNode> = {
  all: <MessageSquareDashed className="size-7" />,
  chats: <MessageSquareDashed className="size-7" />,
  tasks: <ListChecks className="size-7" />,
  inbox: <Inbox className="size-7" />,
};

function HomeEmpty({
  view,
  organizationId,
  scoped,
  showCreate,
}: {
  view: HomeView;
  organizationId: string;
  /** The stream is narrowed to a project: say that, not "nothing yet". */
  scoped: boolean;
  /** The desktop panel offers a first chat here; the phone's Chats view
   * already has New chat above the list. */
  showCreate: boolean;
}) {
  const { t } = useT('home');
  if (scoped) {
    const titleKey =
      view === 'tasks' ? 'scope.emptyTasksTitle' : 'scope.emptyChatsTitle';
    const hintKey =
      view === 'tasks' ? 'scope.emptyTasksHint' : 'scope.emptyChatsHint';
    return (
      <div className="animate-in fade-in-0 slide-in-from-bottom-1 flex flex-col items-center gap-1 px-6 py-10 text-center duration-300 motion-reduce:animate-none">
        <span aria-hidden className="text-muted-foreground/60 mb-1">
          {EMPTY_ICON[view]}
        </span>
        <p className="text-foreground text-sm font-medium">{t(titleKey)}</p>
        <p className="text-muted-foreground text-xs">{t(hintKey)}</p>
      </div>
    );
  }
  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-1 flex flex-col items-center gap-1 px-6 py-10 text-center duration-300 motion-reduce:animate-none">
      <span aria-hidden className="text-muted-foreground/60 mb-1">
        {EMPTY_ICON[view]}
      </span>
      <p className="text-foreground text-sm font-medium">
        {t(`empty.${view}.title`)}
      </p>
      <p className="text-muted-foreground text-xs">{t(`empty.${view}.hint`)}</p>
      {/* The way out of an empty view: a first chat, or the projects where
          tasks are handed out. */}
      {view === 'tasks' ? (
        <Button asChild size="sm" variant="secondary" className="mt-3">
          <Link to="/dashboard/$id/projects" params={{ id: organizationId }}>
            {t('projects.allProjects')}
          </Link>
        </Button>
      ) : showCreate && (view === 'all' || view === 'chats') ? (
        <Button
          asChild
          size="sm"
          variant="secondary"
          icon={SquarePen}
          className="mt-3"
        >
          <Link
            to="/dashboard/$id/chat"
            params={{ id: organizationId }}
            search={{ new: true }}
          >
            {t('newChat')}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
