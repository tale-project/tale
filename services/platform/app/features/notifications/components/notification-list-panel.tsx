'use client';

import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import {
  ArrowDownWideNarrow,
  CheckCheck,
  ChevronLeft,
  ClockArrowDown,
  Inbox,
  Loader2,
  Maximize2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DataTableFilters } from '@/app/components/ui/data-table/data-table-filters';
import {
  useMarkAllNotificationsRead as useMarkAllMyNotificationsRead,
  useMarkNotificationRead as useMarkMyNotificationRead,
} from '@/app/features/inbox/hooks/mutations';
import {
  useMyNotificationsList,
  useUnreadNotificationCount,
} from '@/app/features/inbox/hooks/queries';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { isActionableNotificationType } from '@/lib/shared/attention';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-utils';

import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from '../hooks/mutations';
import {
  useNotificationsList,
  useNotificationsUnreadCount,
  type NotificationsFilter,
} from '../hooks/queries';
import { mergeNotificationsByRecency } from '../lib/merge-notifications';
import {
  orgNotificationTarget,
  personalNotificationTarget,
} from '../lib/notification-target';
import { NotificationRow } from './notification-row';

interface NotificationListPanelProps {
  organizationId: string;
  /** Override the panel height. Defaults to `24rem` in compact layout. */
  className?: string;
  /**
   * `compact` — bell popover / dropdown embed. `expanded` — full-page view
   * (same panel, more vertical space; title lives in the page header).
   */
  layout?: 'compact' | 'expanded';
  /** Called after a row navigates (deep link) so the host popover can close. */
  onNavigate?: () => void;
  /** Compact layout only — opens the full-page notifications view. */
  onExpand?: () => void;
  /**
   * When provided, renders a back-chevron button in the header (left of the
   * title) that invokes this callback. Used by the profile-dropdown integration
   * to swap back to the profile view without closing the dropdown.
   */
  onBack?: () => void;
}

const LOAD_MORE_NUM_ITEMS = 25;

/** How long the sort toggle's tooltip stays open after a click flips the order. */
const SORT_TIP_HOLD_MS = 1500;

// How long the arrival announcement stays in the live region before it is
// cleared, so a subsequent arrival re-announces even when the text is
// identical (screen readers skip a live region whose text did not change).
const ARRIVAL_ANNOUNCE_HOLD_MS = 1000;

// Strip a leading `notifications.` namespace prefix that was accidentally
// stored in earlier rows — we already bind the namespace with
// useT('notifications'), so a prefixed key resolves to nothing.
function stripNsPrefix(key: string): string {
  return key.startsWith('notifications.')
    ? key.slice('notifications.'.length)
    : key;
}

/**
 * Renders the notifications list (header, filter tabs, list, load-more) as
 * an inline panel — no popover wrapper. Use this when embedding notifications
 * inside another surface like the user dropdown / profile panel. For the
 * standalone bell trigger, see `NotificationBell`.
 */
export function NotificationListPanel({
  organizationId,
  className,
  layout = 'compact',
  onNavigate,
  onExpand,
  onBack,
}: NotificationListPanelProps) {
  const [filter, setFilter] = useState<NotificationsFilter>('unread');
  // `priority` floats actionable notifications (reviews, mentions, assignments,
  // escalations) to the top; `recent` keeps the server's created-desc order.
  const [sort, setSort] = useState<'recent' | 'priority'>('recent');
  const [hiddenIds, setHiddenIds] = useState(new Set<string>());
  const { t } = useT('notifications');
  const { t: tInbox } = useT('inbox');
  const { t: tCommon } = useT('common');

  const { results, status, loadMore } = useNotificationsList(organizationId);
  const { data: unread } = useNotificationsUnreadCount(organizationId);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  // The PERSONAL stream (review requests, escalations, task pings) renders
  // interleaved with the org stream — one panel for everything, with inline
  // review actions and task deep links. It is paginated like the org stream so
  // "Load more" walks both, rather than capping the personal inbox.
  const {
    results: myNotifications,
    status: myStatus,
    loadMore: loadMoreMy,
  } = useMyNotificationsList(organizationId);
  const myUnread = useUnreadNotificationCount(organizationId);
  const markMyRead = useMarkMyNotificationRead();
  const markAllMyRead = useMarkAllMyNotificationsRead();

  const handleMarkRead = useCallback(
    (notificationId: Id<'notifications'>) => {
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.add(notificationId);
        return next;
      });
      void markRead.mutateAsync({ notificationId });
    },
    [markRead],
  );

  const handleMarkMyRead = useCallback(
    (notificationId: Id<'userNotifications'>) => {
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.add(notificationId);
        return next;
      });
      void markMyRead.mutateAsync({ notificationId });
    },
    [markMyRead],
  );

  const handleMarkAllRead = useCallback(() => {
    if (filter === 'unread') {
      setHiddenIds((prev) => {
        const next = new Set(prev);
        for (const n of results) {
          if (!n.read) next.add(n._id);
        }
        for (const n of myNotifications) {
          if (!n.read) next.add(n._id);
        }
        return next;
      });
    }
    void markAllRead.mutateAsync({ organizationId });
    void markAllMyRead.mutateAsync({ organizationId });
  }, [
    filter,
    markAllRead,
    markAllMyRead,
    organizationId,
    results,
    myNotifications,
  ]);

  const handleFilterChange = useCallback((next: NotificationsFilter) => {
    setFilter(next);
    setHiddenIds(new Set());
  }, []);

  useEffect(() => {
    if (hiddenIds.size === 0) return;
    const stillPresent = new Set<string>();
    for (const n of results) {
      if (hiddenIds.has(n._id) && !n.read) stillPresent.add(n._id);
    }
    for (const n of myNotifications) {
      if (hiddenIds.has(n._id) && !n.read) stillPresent.add(n._id);
    }
    if (stillPresent.size !== hiddenIds.size) {
      setHiddenIds(stillPresent);
    }
  }, [results, myNotifications, hiddenIds]);

  // Announce newly-arrived notifications to screen readers. A polite, sr-only
  // live region (below) speaks a short message whenever a notification with a
  // timestamp newer than any seen so far appears — so SR users hear arrivals
  // that land while the panel is open. The first render only sets the baseline,
  // so the list already present when the panel opened is never announced.
  const [arrivalAnnouncement, setArrivalAnnouncement] = useState('');
  const latestSeenAtRef = useRef<number | null>(null);
  const clearAnnounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let newest = 0;
    for (const n of results) if (n.createdAt > newest) newest = n.createdAt;
    for (const n of myNotifications)
      if (n.createdAt > newest) newest = n.createdAt;

    const seenAt = latestSeenAtRef.current;
    if (seenAt === null) {
      latestSeenAtRef.current = newest;
      return;
    }
    if (newest > seenAt) {
      latestSeenAtRef.current = newest;
      setArrivalAnnouncement(t('newNotifications'));
      if (clearAnnounceRef.current) clearTimeout(clearAnnounceRef.current);
      clearAnnounceRef.current = setTimeout(
        () => setArrivalAnnouncement(''),
        ARRIVAL_ANNOUNCE_HOLD_MS,
      );
    }
  }, [results, myNotifications, t]);

  useEffect(
    () => () => {
      if (clearAnnounceRef.current) clearTimeout(clearAnnounceRef.current);
    },
    [],
  );

  // Filter client-side so toggling Unread/All never changes the query key (a
  // query reset would re-flash the skeleton). `hiddenIds` covers the optimistic
  // "just marked read" gap before the server-side `read` flag catches up.
  const items = useMemo(
    () =>
      results.filter(
        (n) => !hiddenIds.has(n._id) && (filter === 'all' || !n.read),
      ),
    [results, hiddenIds, filter],
  );
  const myItems = useMemo(
    () =>
      myNotifications.filter(
        (n) => !hiddenIds.has(n._id) && (filter === 'all' || !n.read),
      ),
    [myNotifications, hiddenIds, filter],
  );
  // One chronologically sorted stream across BOTH sources (#2377); optional
  // priority sort floats actionable personal rows to the top.
  const mergedItems = useMemo(() => {
    const merged = mergeNotificationsByRecency(myItems, items);
    if (sort !== 'priority') return merged;
    return [...merged].sort((a, b) => {
      const aPriority =
        a.kind === 'personal' && isActionableNotificationType(a.item.type)
          ? 1
          : 0;
      const bPriority =
        b.kind === 'personal' && isActionableNotificationType(b.item.type)
          ? 1
          : 0;
      if (aPriority !== bPriority) return bPriority - aPriority;
      return b.item.createdAt - a.item.createdAt;
    });
  }, [myItems, items, sort]);
  const unreadCount = (unread ?? 0) + myUnread;
  // Drive one "Load more" affordance off BOTH streams: it's enabled while
  // either has another page, shows progress while either is fetching, and a
  // click advances every stream that still has more.
  const canLoadMore = status === 'CanLoadMore' || myStatus === 'CanLoadMore';
  const isLoadingMore = status === 'LoadingMore' || myStatus === 'LoadingMore';
  const hasVisibleItems = items.length > 0 || myItems.length > 0;
  // Pagination is server-side over the full stream (read + unread); the Unread
  // tab filters client-side. When you're caught up (`unreadCount === 0`) the
  // remaining pages are only read history — "Load more" would not surface
  // anything visible and contradicts the empty state.
  const showLoadMore =
    (canLoadMore || isLoadingMore) &&
    (hasVisibleItems || filter === 'all' || unreadCount > 0);
  const handleLoadMore = useCallback(() => {
    if (status === 'CanLoadMore') loadMore(LOAD_MORE_NUM_ITEMS);
    if (myStatus === 'CanLoadMore') loadMoreMy(LOAD_MORE_NUM_ITEMS);
  }, [status, loadMore, myStatus, loadMoreMy]);

  // Radix force-closes a tooltip the moment its trigger is clicked — which is
  // exactly when this toggle's tip starts announcing the NEW order. And once
  // an outside force-close desyncs its hover tracking, it can stop requesting
  // opens altogether. So this tip's state is OURS end to end: Radix only
  // renders `open`; our pointer/focus/click handlers decide it. A click flips
  // the sort, swaps the icon, and holds the re-labelled tip open for a fixed
  // beat during which nothing else may close it; hover opens after the shared
  // 300ms tooltip delay and closes on leave; focus/blur mirror that for
  // keyboard users.
  const [sortTipOpen, setSortTipOpen] = useState(false);
  const sortTipHoldUntil = useRef(0);
  // One pending op at a time: either the delayed hover-open or the hold-close.
  const sortTipTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(sortTipTimer.current), []);
  const handleSortPointerEnter = useCallback(() => {
    if (Date.now() < sortTipHoldUntil.current) return;
    window.clearTimeout(sortTipTimer.current);
    sortTipTimer.current = window.setTimeout(() => setSortTipOpen(true), 300);
  }, []);
  const handleSortPointerLeave = useCallback(() => {
    if (Date.now() < sortTipHoldUntil.current) return;
    window.clearTimeout(sortTipTimer.current);
    setSortTipOpen(false);
  }, []);
  const handleSortFocus = useCallback(() => {
    if (Date.now() < sortTipHoldUntil.current) return;
    setSortTipOpen(true);
  }, []);
  const handleSortBlur = useCallback(() => {
    window.clearTimeout(sortTipTimer.current);
    sortTipHoldUntil.current = 0;
    setSortTipOpen(false);
  }, []);
  const handleSortClick = useCallback(() => {
    setSort((prev) => (prev === 'priority' ? 'recent' : 'priority'));
    sortTipHoldUntil.current = Date.now() + SORT_TIP_HOLD_MS;
    window.clearTimeout(sortTipTimer.current);
    setSortTipOpen(true);
    sortTipTimer.current = window.setTimeout(() => {
      setSortTipOpen(false);
    }, SORT_TIP_HOLD_MS);
  }, []);

  const sortLabel = `${t('sortLabel')}: ${sort === 'priority' ? t('sortPriority') : t('sortRecent')}`;
  const sortButton = (
    <IconButton
      variant="ghost"
      size="sm"
      // The icon names the CURRENT order — time-descending for "Most recent",
      // magnitude-descending for "Priority" — so it flips together with the
      // label and the held-open tip.
      icon={sort === 'priority' ? ArrowDownWideNarrow : ClockArrowDown}
      aria-pressed={sort === 'priority'}
      aria-label={sortLabel}
      tooltipOpen={sortTipOpen}
      onClick={handleSortClick}
      onPointerEnter={handleSortPointerEnter}
      onPointerLeave={handleSortPointerLeave}
      onFocus={handleSortFocus}
      onBlur={handleSortBlur}
    />
  );

  const showHeaderRow = onBack != null || layout === 'compact';

  return (
    <div
      className={cn(
        'flex flex-col',
        layout === 'compact' ? 'h-[24rem]' : 'min-h-0 flex-1',
        className,
      )}
    >
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {arrivalAnnouncement}
      </div>
      <div className="border-border flex flex-col gap-2.5 border-b px-4 py-3">
        {showHeaderRow && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  aria-label={tCommon('actions.back')}
                  className="hover:bg-muted -ml-1.5 flex size-6 shrink-0 items-center justify-center rounded-md transition-colors"
                >
                  <ChevronLeft className="text-muted-foreground size-4" />
                </button>
              )}
              {layout === 'compact' && (
                <span className="truncate text-sm font-semibold">
                  {t('title')}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {layout === 'compact' && onExpand && (
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon={Maximize2}
                  aria-label={t('expand')}
                  onClick={onExpand}
                />
              )}
            </div>
          </div>
        )}
        {/* One filter bar: the shared filter button (Unread is the resting
            state, so it carries no active dot) and the sort toggle on the
            left, mark-all-as-read on the right — all on one baseline. */}
        <DataTableFilters
          filters={[
            {
              key: 'status',
              title: t('filterLabel'),
              options: [
                {
                  value: 'unread',
                  label:
                    unreadCount > 0
                      ? `${t('filterUnread')} (${unreadCount > 99 ? '99+' : unreadCount})`
                      : t('filterUnread'),
                },
                { value: 'all', label: t('filterAll') },
              ],
              selectedValues: [filter],
              defaultValues: ['unread'],
              onChange: (values) => {
                handleFilterChange(values[0] === 'all' ? 'all' : 'unread');
              },
            },
          ]}
          actions={
            unreadCount > 0 ? (
              <IconButton
                variant="ghost"
                size="sm"
                icon={CheckCheck}
                aria-label={t('markAllAsRead')}
                disabled={markAllRead.isPending || markAllMyRead.isPending}
                onClick={handleMarkAllRead}
              />
            ) : undefined
          }
        >
          {sortButton}
        </DataTableFilters>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {items.length === 0 && myItems.length === 0 ? (
          status === 'LoadingFirstPage' || myStatus === 'LoadingFirstPage' ? (
            // Short-lived async load — a centered spinner + label reads
            // cleaner than a fake-content skeleton when items typically
            // arrive in under a second.
            <div
              role="status"
              aria-live="polite"
              className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center"
            >
              <Loader2
                aria-hidden="true"
                className="size-5 motion-safe:animate-spin"
              />
              <p className="text-xs">{t('loading')}</p>
            </div>
          ) : (
            <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
              {filter === 'unread' ? (
                <CheckCheck className="size-8" aria-hidden="true" />
              ) : (
                <Inbox className="size-8" aria-hidden="true" />
              )}
              <p className="text-foreground text-sm font-medium">
                {filter === 'unread'
                  ? t('emptyCaughtUpTitle')
                  : t('emptyAllTitle')}
              </p>
              {/* Reserve two text-xs lines — the same trick the shared
                  EmptyState uses (min-h for 2 lines) — so the one-line and
                  two-line filter states share one height and the panel does
                  not jump when switching filters. */}
              <p className="min-h-8 text-xs">
                {filter === 'unread'
                  ? t('emptyCaughtUpDescription')
                  : t('emptyAllDescription')}
              </p>
            </div>
          )
        ) : (
          <ul role="list" className="divide-border divide-y">
            {mergedItems.map((entry) => {
              if (entry.kind === 'personal') {
                const n = entry.item;
                const params = isRecord(n.params) ? n.params : undefined;
                const target = personalNotificationTarget({
                  organizationId,
                  taskId: n.taskId,
                  params: n.params,
                });
                return (
                  <NotificationRow
                    key={`personal:${n._id}`}
                    title={tInbox(n.titleKey)}
                    body={tInbox(
                      n.bodyKey,
                      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- jsonRecord interpolation map
                      params as Record<string, string | number>,
                    )}
                    createdAt={n.createdAt}
                    read={n.read}
                    target={target}
                    onActivate={() => {
                      if (!n.read) handleMarkMyRead(n._id);
                      onNavigate?.();
                    }}
                    onMarkRead={() => handleMarkMyRead(n._id)}
                    markReadPending={markMyRead.isPending}
                  />
                );
              }
              const n = entry.item;
              const params = isRecord(n.params) ? n.params : undefined;
              const target = orgNotificationTarget(
                organizationId,
                n.link,
                n.category,
              );
              return (
                <NotificationRow
                  key={`org:${n._id}`}
                  title={t(stripNsPrefix(n.titleKey), params)}
                  body={t(stripNsPrefix(n.bodyKey), params)}
                  createdAt={n.createdAt}
                  read={n.read}
                  target={target}
                  onActivate={() => {
                    if (!n.read) handleMarkRead(n._id);
                    onNavigate?.();
                  }}
                  onMarkRead={() => handleMarkRead(n._id)}
                  markReadPending={markRead.isPending}
                />
              );
            })}
          </ul>
        )}
        {showLoadMore && (
          <div className="border-border border-t p-2">
            <Button
              variant="ghost"
              className="w-full"
              disabled={!canLoadMore}
              onClick={handleLoadMore}
            >
              {isLoadingMore ? t('loading') : t('loadMore')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
