import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { cn } from '@tale/ui/cn';
import { EmptyState } from '@tale/ui/empty-state';
import { SlidingHighlight } from '@tale/ui/section-nav';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useInfiniteScroll } from '@tale/ui/use-infinite-scroll';
import { useSlidingIndicator } from '@tale/ui/use-sliding-indicator';
import { useLocation } from '@tanstack/react-router';
import { AppWindow, LoaderCircle, Network, Plus } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { ImportProxiesDialog } from '@/app/features/proxies/components/import-proxies-dialog';
import { useMeta } from '@/app/hooks/use-meta';
import { readFailureText } from '@/app/lib/api/failure';
import { SPIN_CLASS } from '@/app/lib/pending-icon';
import { parseSessionId } from '@/app/lib/session-id';
import { useT } from '@/lib/i18n/client';

import { useBrowserBlock } from '../hooks/use-browser-block';
import { useEnteringIds } from '../hooks/use-entering-ids';
import {
  useOpenSessionOutsideRows,
  withOpenSession,
} from '../hooks/use-open-session';
import { useRowFocusRescue } from '../hooks/use-row-focus-rescue';
import { useSessionList } from '../hooks/use-session-list';
import { revealRow } from '../lib/reveal-row';
import { adjacentRow, rowFocusIndex, rowLinks } from '../lib/row-navigation';
import { SessionRow } from './session-row';
import { SessionRowsSkeleton } from './session-rows-skeleton';

/**
 * The session whose page the path is, if it is one: the id as the session page
 * reads it, so an address that names no session (`/sessions/007`) marks no row
 * and asks the backend for nothing.
 */
export function openSessionId(pathname: string): number | null {
  const match = /^\/sessions\/([^/]+)(?:\/|$)/.exec(pathname);
  return match?.[1] === undefined ? null : parseSessionId(match[1]);
}

interface SessionListProps {
  /** Opens the dialog that adds a session. */
  onAdd: () => void;
  /**
   * Where the keyboard goes when a retry that worked takes away the alert it
   * was on: the first control of the list's frame (the button that adds a
   * session), not the page.
   */
  onFocusLost: () => void;
  /**
   * The level of the empty state's title: under the panel's own title it is a
   * third level, on a page that has only the page title a second.
   */
  headingLevel?: 2 | 3;
}

/**
 * The sessions, newest first, as rows that link to their pages: loaded as the
 * end of the list scrolls into view, the open one marked by a highlight that
 * glides to it and kept in sight (it is scrolled to when it opens, and shown
 * as a row of its own while the rows loaded do not reach it). A first load is
 * masked in place, a list with none says how to get one, and a load that
 * failed says so with a retry above the rows it already has. The panel beside
 * the page and the phone's whole-screen list are this one list. Where there
 * are no proxies either, the way on is to add some right there, in the dialog
 * that imports them.
 *
 * With the keyboard the arrow keys, Home and End move from row to row, and Alt
 * with Up or Down opens the previous or next session from anywhere but a text
 * field, as in the platform's Home list.
 */
export function SessionList({
  onAdd,
  onFocusLost,
  headingLevel = 3,
}: SessionListProps) {
  const { t } = useT('sessions');
  const { t: tErrors } = useT('errors');
  const list = useSessionList();
  const meta = useMeta();
  const browserBlock = useBrowserBlock();
  const { pathname } = useLocation();
  const openId = openSessionId(pathname);
  const open = useOpenSessionOutsideRows(openId, list.sessions);

  const scroller = useRef<HTMLDivElement | null>(null);
  const shown = useMemo(
    () => withOpenSession(list.sessions, open),
    [list.sessions, open],
  );
  const ids = useMemo(() => shown.map((session) => session.id), [shown]);
  // Only the rows the list itself loads can drop in; the open one is there
  // because its page is.
  const loadedIds = useMemo(
    () => list.sessions.map((session) => session.id),
    [list.sessions],
  );
  const entering = useEnteringIds(loadedIds, list.isPending);
  const indicator = useSlidingIndicator<HTMLDivElement>(
    openId === null ? null : String(openId),
    ids.join(','),
  );
  const { containerRef } = indicator;
  const setScroller = useCallback(
    (node: HTMLDivElement | null) => {
      scroller.current = node;
      containerRef(node);
    },
    [containerRef],
  );
  useRowFocusRescue(scroller);
  const { sentinelRef } = useInfiniteScroll({
    onLoadMore: list.loadMore,
    hasMore: list.hasMore,
    isLoading: list.isLoadingMore,
    threshold: 400,
    root: scroller,
  });

  // The open session is older than every row loaded when its page was opened
  // from a link: the rows are read back to it, in one request for the sessions
  // from it up, so that it stands where it belongs (it is shown as a row of its
  // own meanwhile). One that is not among them, as a session that was deleted,
  // is asked for once.
  const oldestLoaded = list.sessions.at(-1)?.id;
  const reached =
    openId === null ||
    !list.hasMore ||
    oldestLoaded === undefined ||
    openId >= oldestLoaded;
  const { isPending, isLoadingMore, readBackTo } = list;
  useEffect(() => {
    if (!reached && !isPending && !isLoadingMore) readBackTo(openId);
  }, [reached, openId, isPending, isLoadingMore, readBackTo]);

  // Keep the open session in sight, as the Home list does: when a session
  // opens from elsewhere (a link, a new tab) its row is scrolled to, once,
  // as soon as it stands where it belongs; not again as the list is read
  // afresh. Only the list is scrolled (`revealRow`): `scrollIntoView` would
  // also move the starting point of the tab key to the row, and the first Tab
  // of the page would skip the skip link.
  const revealed = useRef<number | null>(null);
  useEffect(() => {
    if (openId === null) {
      revealed.current = null;
      return;
    }
    if (revealed.current === openId || !reached || !ids.includes(openId)) {
      return;
    }
    const root = scroller.current;
    if (root === null) return;
    const row = root.querySelector<HTMLElement>(
      `a[data-indicator-key="${CSS.escape(String(openId))}"]`,
    );
    if (row === null) return;
    revealed.current = openId;
    revealRow(root, row);
  }, [openId, ids, reached]);

  // Alt with Up or Down opens the previous or next session, whichever element
  // has the keyboard (but a text field, a dialog).
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const root = scroller.current;
      if (root === null) return;
      const row = adjacentRow(event, root);
      if (row === null) return;
      event.preventDefault();
      revealRow(root, row);
      row.click();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // The arrow keys, Home and End move the focus from one row's link to the
  // next; Tab keeps its order (the link, Start or Stop, the menu).
  const moveBetweenRows = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLAnchorElement)) return;
    const links = rowLinks(event.currentTarget);
    const at = links.indexOf(target);
    const next = rowFocusIndex(event, at, links.length);
    if (next === null) return;
    event.preventDefault();
    links[next]?.focus();
  };

  // Rows that stay may be out of date; a list with none says only that it could not be read.
  const failed = list.isError
    ? readFailureText(
        list.sessions.length === 0
          ? t('list.loadFailed')
          : t('list.refreshFailed'),
        list.error,
        tErrors,
      )
    : null;
  const retry = () => void list.refetch();
  const failure = (message: string) => (
    <CatalogLoadError
      message={message}
      onRetry={retry}
      isRetrying={list.isFetching}
      failureKey={list.errorUpdatedAt}
      onFocusLost={onFocusLost}
    />
  );
  const noProxies = meta.data?.counts.proxies === 0;
  const [importing, setImporting] = useState(false);

  // With no sessions to show, what the empty list says depends on the proxies
  // there are, so the rows stay masked until the app has told. The counts,
  // which the root route has in before the first frame, also tell a list with
  // no session while its rows are on their way: it says so from the start,
  // instead of masked rows that vanish when the rows come.
  const counted = meta.data?.counts.sessions;
  const waiting =
    (list.isPending && counted !== 0) ||
    (list.sessions.length === 0 && failed === null && meta.isPending);

  let body: ReactNode;
  if (waiting) {
    body = (
      <Skeletonize loading>
        <SessionRowsSkeleton count={counted} />
      </Skeletonize>
    );
  } else if (list.sessions.length === 0) {
    body =
      failed !== null ? (
        failure(failed)
      ) : (
        <EmptyState
          icon={AppWindow}
          headingLevel={headingLevel}
          title={t('empty.title')}
          description={
            noProxies ? t('empty.noProxies') : t('empty.description')
          }
          // One button in either state, so that the focus stays on it when
          // the proxies are there and it offers the first session instead.
          action={
            <Button
              type="button"
              icon={noProxies ? Network : Plus}
              onClick={noProxies ? () => setImporting(true) : onAdd}
              disabled={!noProxies && browserBlock !== null}
              disabledReason={
                noProxies ? undefined : (browserBlock ?? undefined)
              }
            >
              {noProxies ? t('addProxies') : t('panel.add')}
            </Button>
          }
        />
      );
  } else {
    body = (
      <>
        {failed !== null && <div className="mb-2">{failure(failed)}</div>}
        <ul role="list" className="flex list-none flex-col gap-0.5">
          {shown.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              active={session.id === openId}
              entering={entering.has(session.id)}
            />
          ))}
        </ul>
        <div
          ref={sentinelRef}
          className="text-muted-foreground flex min-h-9 shrink-0 items-center justify-center gap-2 px-2 pt-2 text-xs"
        >
          {list.isLoadingMore ? (
            <span role="status" className="flex items-center gap-2">
              <LoaderCircle
                aria-hidden
                className={cn('size-3.5', SPIN_CLASS)}
              />
              {t('list.loadingMore')}
            </span>
          ) : list.hasMore ? (
            t('list.partial', {
              loaded: list.sessions.length,
              count: list.total,
            })
          ) : (
            t('list.total', { count: list.total })
          )}
        </div>
      </>
    );
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the region only relays arrow keys between its row links, as the platform's Home list does
    <div
      ref={setScroller}
      role="region"
      aria-label={t('list.label')}
      // Where focus goes when a deleted row takes every control it held.
      tabIndex={-1}
      onKeyDown={moveBetweenRows}
      className="mobile-nav-clearance mobile-nav-inset mobile-nav-scroll scrollbar-thin relative flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 py-2.5 outline-none"
    >
      <SlidingHighlight indicator={indicator} />
      {body}
      {importing && <ImportProxiesDialog open onOpenChange={setImporting} />}
    </div>
  );
}
