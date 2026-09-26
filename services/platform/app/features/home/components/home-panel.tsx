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
import { Skeletonize } from '@tale/ui/skeleton-context';
import { SubPanel } from '@tale/ui/sub-panel';
import { Tooltip } from '@tale/ui/tooltip';
import { useIsMac } from '@tale/ui/use-is-mac';
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
  type ReactNode,
  type RefObject,
} from 'react';

import { TOOLTIP_SHORTCUT_CLASS } from '@/app/components/layout/app-sidebar/sidebar-motion';
import { HomeRowsSkeleton } from '@/app/components/layout/home-panel-skeleton';
import { ArchivedSection } from '@/app/features/chat/components/archived-section';
import {
  ThreadDndProvider,
  useStayDropZone,
} from '@/app/features/chat/components/thread-dnd';
import {
  ThreadListFrameProvider,
  type ThreadListFrame,
} from '@/app/features/chat/components/thread-list-context';
import { useThreadHolds } from '@/app/features/chat/data/chat-backend';
import { useClockOffset } from '@/app/hooks/use-clock-offset';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useT } from '@/lib/i18n/client';

import { useHomeData } from '../hooks/use-home-data';
import {
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
 * beside every Home route. It folds to nothing when hidden — the inner column
 * keeps its width, so the fold is a clip, not a reflow.
 */
export function HomePanel({ organizationId }: { organizationId: string }) {
  const { t } = useT('home');
  const { open: storedOpen, setMounted } = useHomePanel();
  const { pathname, search } = useLocation();
  // Only a conversation-shaped page (a chat, a task, an open conversation)
  // carries the toggle in its header, so only there may the panel fold away;
  // everywhere else in Home it stays, or it could not be brought back.
  const open =
    storedOpen ||
    !isPanelCollapsible(readHomeLocation(pathname, search, organizationId));
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
      className={cn(
        '[transition:width_260ms_var(--ease-out-quint)] motion-reduce:transition-none',
        !open && 'w-0 border-r-0',
      )}
    >
      <div
        inert={!open || undefined}
        aria-hidden={!open}
        className="flex h-full w-70 shrink-0 flex-col overflow-hidden"
      >
        <HomePanelHeader organizationId={organizationId} />
        <HomeNavigator organizationId={organizationId} />
      </div>
    </SubPanel>
  );
}

/**
 * Everything Home lists — the view switcher, the projects, and the stream of
 * chats, tasks and conversations (or the Inbox view's tools). The desktop
 * panel frames it beside the page; on a phone it is the Home screen itself.
 */
export function HomeNavigator({ organizationId }: { organizationId: string }) {
  const { t } = useT('home');
  const { pathname, search } = useLocation();
  const location = readHomeLocation(pathname, search, organizationId);

  const [storedView, setView] = usePersistedState<HomeView>(
    `home-view-${organizationId}`,
    'all',
  );
  const [storedInboxStatus, setInboxStatus] = usePersistedState<InboxStatus>(
    `home-inbox-status-${organizationId}`,
    'open',
  );
  // On an inbox route the URL's status wins, so the stream shows the tab the
  // open conversation lives in.
  const inboxStatus =
    location.kind === 'conversation' && isInboxStatus(location.status)
      ? location.status
      : storedInboxStatus;

  const data = useHomeData(organizationId, inboxStatus);
  const view: HomeView =
    isHomeView(storedView) && (storedView !== 'inbox' || data.hasInbox)
      ? storedView
      : 'all';

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

  const { serverEpochNow } = useClockOffset();
  const now = serverEpochNow();
  const groups = useMemo(
    () =>
      groupHomeItems(
        data.items.filter(
          (item) =>
            viewIncludes(view, item.kind) &&
            // The All view keeps only the conversations still open — the
            // closed, spam and archived tabs live in the Inbox view.
            (view === 'inbox' ||
              item.kind !== 'conversation' ||
              item.status === 'open'),
        ),
        now,
      ),
    // `now` moves every render; the bands only need to follow the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.items, view],
  );

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
        (location.threadId ?? 'draft')
      : location.kind === 'task'
        ? location.taskId
        : location.kind === 'conversation'
          ? location.conversationId
          : undefined;
  useEffect(() => {
    if (activeKey === undefined) return;
    const row = streamRef.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeKey, view, streamLoading]);

  const projectsById = useMemo(
    () => new Map(data.projects.map((project) => [project.id, project])),
    [data.projects],
  );

  const draftingChat =
    location.kind === 'chat' &&
    location.threadId === undefined &&
    viewIncludes(view, 'chat');
  const searchRecord: Record<string, unknown> = search;
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

  const renderRow = (item: HomeItem) => {
    const active = isActive(item, location);
    if (item.kind === 'chat') {
      const thread = data.threadsById.get(item.id);
      if (thread === undefined) return null;
      return (
        <HomeChatRow
          key={homeItemKey(item)}
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
          item={item}
          organizationId={organizationId}
          active={active}
        />
      );
    }
    return (
      <HomeConversationRow
        key={homeItemKey(item)}
        item={item}
        organizationId={organizationId}
        active={active}
      />
    );
  };

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 px-2.5 pt-2.5 pb-2">
        <HomeViewSwitcher
          value={view}
          options={switcherOptions}
          onChange={setView}
        />
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
            <div className="flex min-h-0 flex-1 flex-col px-2.5 pb-3">
              <HomeProjects
                organizationId={organizationId}
                projects={data.projects}
                loading={data.loading.projects}
                {...(location.kind === 'project' &&
                location.projectId !== undefined
                  ? { activeProjectId: location.projectId }
                  : {})}
              />

              <HomeStreamScroller scrollerRef={streamRef}>
                {streamLoading ? (
                  <Skeletonize loading className="flex flex-col gap-0.5 pt-2">
                    <HomeRowsSkeleton />
                  </Skeletonize>
                ) : groups.length === 0 && !draftingChat ? (
                  <HomeEmpty view={view} />
                ) : (
                  <ol
                    // Re-keyed per view, so switching views fades the new
                    // list in instead of swapping rows in place.
                    key={view}
                    aria-label={t('aria.stream')}
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

              {(view === 'all' || view === 'chats') && <ArchivedSection />}
            </div>
          </ThreadDndProvider>
        </ThreadListFrameProvider>
      )}
    </>
  );
}

/**
 * The stream's scroller, and the place a dragged chat is put back: releasing
 * a row over the stream leaves it where it was, rather than filing it into
 * whichever project or drawer the lifted card grazes.
 */
function HomeStreamScroller({
  scrollerRef,
  children,
}: {
  scrollerRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const setDropRef = useStayDropZone();
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      scrollerRef.current = node;
      setDropRef(node);
    },
    [scrollerRef, setDropRef],
  );
  return (
    <div
      ref={setRefs}
      className="scrollbar-thin border-border/70 -mx-2.5 mt-2 min-h-0 flex-1 overflow-y-auto border-t px-2.5"
    >
      {children}
    </div>
  );
}

function HomePanelHeader({ organizationId }: { organizationId: string }) {
  const { t } = useT('home');
  const isMac = useIsMac();
  const shortcut = isMac ? '⌥ ⌘ N' : 'ALT + CTRL + N';
  return (
    <div className="border-border flex h-13 shrink-0 items-center justify-between gap-2 border-b pr-2.5 pl-4">
      <h2 className="text-foreground truncate text-[15px] font-semibold tracking-tight">
        {t('title')}
      </h2>
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
          className="text-muted-foreground hover:text-foreground size-8 transition-transform active:scale-95"
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
    </div>
  );
}

const EMPTY_ICON: Record<HomeView, ReactNode> = {
  all: <MessageSquareDashed className="size-7" />,
  chats: <MessageSquareDashed className="size-7" />,
  tasks: <ListChecks className="size-7" />,
  inbox: <Inbox className="size-7" />,
};

function HomeEmpty({ view }: { view: HomeView }) {
  const { t } = useT('home');
  return (
    <div className="animate-in fade-in-0 flex flex-col items-center gap-1 px-6 py-10 text-center duration-300">
      <span aria-hidden className="text-muted-foreground/60 mb-1">
        {EMPTY_ICON[view]}
      </span>
      <p className="text-foreground text-sm font-medium">
        {t(`empty.${view}.title`)}
      </p>
      <p className="text-muted-foreground text-xs">{t(`empty.${view}.hint`)}</p>
    </div>
  );
}
