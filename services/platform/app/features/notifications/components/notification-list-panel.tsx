'use client';

import { Button } from '@tale/ui/button';
import { Tabs } from '@tale/ui/tabs';
import { CheckCheck, ChevronLeft, Inbox, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
import { ReviewActions } from './review-actions';

interface NotificationListPanelProps {
  organizationId: string;
  /** Override the panel height. Defaults to `24rem`. */
  className?: string;
  /** Called after a row navigates (deep link) so the host popover can close. */
  onNavigate?: () => void;
  /**
   * When provided, renders a back-chevron button in the header (left of the
   * title) that invokes this callback. Used by the profile-dropdown integration
   * to swap back to the profile view without closing the dropdown.
   */
  onBack?: () => void;
}

const LOAD_MORE_NUM_ITEMS = 25;

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
  onNavigate,
  onBack,
}: NotificationListPanelProps) {
  const [filter, setFilter] = useState<NotificationsFilter>('unread');
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
  // One chronologically sorted stream across BOTH sources (#2377): an old
  // personal item must never outrank a newer org alert. The per-source visual
  // distinction stays an icon/namespace concern, not a positional one.
  const mergedItems = useMemo(
    () => mergeNotificationsByRecency(myItems, items),
    [myItems, items],
  );
  const unreadCount = (unread ?? 0) + myUnread;
  // Drive one "Load more" affordance off BOTH streams: it's enabled while
  // either has another page, shows progress while either is fetching, and a
  // click advances every stream that still has more.
  const canLoadMore = status === 'CanLoadMore' || myStatus === 'CanLoadMore';
  const isLoadingMore = status === 'LoadingMore' || myStatus === 'LoadingMore';
  const handleLoadMore = useCallback(() => {
    if (status === 'CanLoadMore') loadMore(LOAD_MORE_NUM_ITEMS);
    if (myStatus === 'CanLoadMore') loadMoreMy(LOAD_MORE_NUM_ITEMS);
  }, [status, loadMore, myStatus, loadMoreMy]);

  return (
    <div className={cn('flex h-[24rem] flex-col', className)}>
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {arrivalAnnouncement}
      </div>
      <div className="border-border flex flex-col gap-2 border-b px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label={tCommon('actions.back')}
                className="hover:bg-muted -ml-1.5 flex size-6 items-center justify-center rounded-md transition-colors"
              >
                <ChevronLeft className="text-muted-foreground size-4" />
              </button>
            )}
            <span className="text-sm font-semibold">{t('title')}</span>
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              disabled={markAllRead.isPending || markAllMyRead.isPending}
              onClick={handleMarkAllRead}
            >
              {t('markAllAsRead')}
            </Button>
          )}
        </div>
        <Tabs
          value={filter}
          onValueChange={(v) => {
            if (v === 'unread' || v === 'all') handleFilterChange(v);
          }}
          // The host popover surface is itself `dark:bg-muted`, so the pill
          // track's default `bg-muted` vanishes into the panel in dark mode.
          // Recess the track to the base surface so the segmented control
          // reads as a proper well with the active pill raised on top.
          listClassName="dark:bg-bg-base"
          items={[
            {
              value: 'unread',
              label:
                unreadCount > 0
                  ? `${t('filterUnread')} (${unreadCount > 99 ? '99+' : unreadCount})`
                  : t('filterUnread'),
            },
            { value: 'all', label: t('filterAll') },
          ]}
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 && myItems.length === 0 ? (
          status === 'LoadingFirstPage' || myStatus === 'LoadingFirstPage' ? (
            // Short-lived async load — a centered spinner + label reads
            // cleaner than a fake-content skeleton when items typically
            // arrive in under a second.
            <div
              role="status"
              aria-live="polite"
              className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
            >
              <Loader2
                aria-hidden="true"
                className="size-5 motion-safe:animate-spin"
              />
              <p className="text-xs">{t('loading')}</p>
            </div>
          ) : (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
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
              <p className="text-xs">
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
                const approvalId =
                  n.type === 'task_review_requested' &&
                  typeof params?.approvalId === 'string'
                    ? params.approvalId
                    : undefined;
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
                      // `params` is the i18n interpolation map (stored as
                      // v.any()); narrow to what t() accepts.
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
                  >
                    {approvalId && (
                      <ReviewActions
                        notificationId={n._id}
                        approvalId={approvalId}
                      />
                    )}
                  </NotificationRow>
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
        {(canLoadMore || isLoadingMore) && (
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
