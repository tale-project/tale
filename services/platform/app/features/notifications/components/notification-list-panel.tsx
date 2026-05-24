'use client';

import { Button } from '@tale/ui/button';
import { Tabs } from '@tale/ui/tabs';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useFormatDate } from '@/app/hooks/use-format-date';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-guards';

import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from '../hooks/mutations';
import {
  useNotificationsList,
  useNotificationsUnreadCount,
  type NotificationsFilter,
} from '../hooks/queries';

interface NotificationListPanelProps {
  organizationId: string;
  /** Override the panel height. Defaults to `24rem`. */
  className?: string;
  /**
   * When provided, renders a back-chevron button in the header (left of the
   * title) that invokes this callback. Used by the profile-dropdown integration
   * to swap back to the profile view without closing the dropdown.
   */
  onBack?: () => void;
}

const SEVERITY_DOT: Record<string, string> = {
  info: 'bg-sky-500',
  warning: 'bg-amber-500',
  critical: 'bg-red-500',
};

const LOAD_MORE_NUM_ITEMS = 25;

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
  onBack,
}: NotificationListPanelProps) {
  const [expandedId, setExpandedId] = useState<Id<'notifications'> | null>(
    null,
  );
  const [filter, setFilter] = useState<NotificationsFilter>('unread');
  const [hiddenIds, setHiddenIds] = useState(new Set<string>());
  const { t } = useT('notifications');
  const { t: tCommon } = useT('common');
  const { formatRelative, formatDate } = useFormatDate();

  const { results, status, loadMore } = useNotificationsList(
    organizationId,
    filter,
  );
  const { data: unread } = useNotificationsUnreadCount(organizationId);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const handleToggleExpand = useCallback(
    (notificationId: Id<'notifications'>) => {
      setExpandedId((current) =>
        current === notificationId ? null : notificationId,
      );
    },
    [],
  );

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

  const handleMarkAllRead = useCallback(() => {
    if (filter === 'unread') {
      setHiddenIds((prev) => {
        const next = new Set(prev);
        for (const n of results) {
          if (!n.read) next.add(n._id);
        }
        return next;
      });
    }
    void markAllRead.mutateAsync({ organizationId });
  }, [filter, markAllRead, organizationId, results]);

  const handleFilterChange = useCallback((next: NotificationsFilter) => {
    setFilter(next);
    setExpandedId(null);
    setHiddenIds(new Set());
  }, []);

  useEffect(() => {
    if (hiddenIds.size === 0) return;
    const stillPresent = new Set<string>();
    for (const n of results) {
      if (hiddenIds.has(n._id) && !n.read) stillPresent.add(n._id);
    }
    if (stillPresent.size !== hiddenIds.size) {
      setHiddenIds(stillPresent);
    }
  }, [results, hiddenIds]);

  const items = useMemo(
    () => results.filter((n) => !hiddenIds.has(n._id)),
    [results, hiddenIds],
  );
  const unreadCount = unread ?? 0;
  const canLoadMore = status === 'CanLoadMore';
  const isLoadingMore = status === 'LoadingMore';

  return (
    <div className={cn('flex h-[24rem] flex-col', className)}>
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
              size="sm"
              variant="ghost"
              disabled={markAllRead.isPending}
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
        {items.length === 0 ? (
          <div className="text-muted-foreground px-4 py-8 text-center text-sm">
            {status === 'LoadingFirstPage' ? t('loading') : t('empty')}
          </div>
        ) : (
          <ul className="divide-border divide-y">
            {items.map((n) => {
              const params = isRecord(n.params) ? n.params : undefined;
              const title = t(stripNsPrefix(n.titleKey), params);
              const body = t(stripNsPrefix(n.bodyKey), params);
              const isExpanded = expandedId === n._id;
              const Chevron = isExpanded ? ChevronDown : ChevronRight;

              return (
                <li
                  key={n._id}
                  className={cn(
                    'transition-colors',
                    !n.read && 'bg-accent/10',
                    n.read && 'opacity-70',
                  )}
                >
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => handleToggleExpand(n._id)}
                    className="hover:bg-muted/60 flex w-full items-start gap-3 px-4 py-3 text-left transition-colors"
                  >
                    <span
                      className={cn(
                        'mt-1.5 size-2 shrink-0 rounded-full',
                        SEVERITY_DOT[n.severity] ?? 'bg-muted-foreground',
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div
                          className={cn(
                            'text-foreground text-sm font-medium',
                            !isExpanded && 'truncate',
                          )}
                        >
                          {title}
                        </div>
                        <span className="text-muted-foreground shrink-0 text-[10px]">
                          {formatRelative(new Date(n.createdAt))}
                        </span>
                      </div>
                      <div
                        className={cn(
                          'text-muted-foreground mt-0.5 text-xs whitespace-pre-wrap',
                          !isExpanded && 'line-clamp-2',
                        )}
                      >
                        {body}
                      </div>
                    </div>
                    <Chevron
                      className="text-muted-foreground mt-1 size-4 shrink-0"
                      aria-hidden
                    />
                    {!n.read && !isExpanded && (
                      <span
                        aria-label={t('ariaUnread')}
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-sky-500"
                      />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="flex items-center justify-between gap-3 px-4 pt-0 pb-3 pl-9">
                      <span className="text-muted-foreground text-[11px]">
                        {formatDate(new Date(n.createdAt), 'long')}
                      </span>
                      {!n.read && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={markRead.isPending}
                          onClick={() => handleMarkRead(n._id)}
                        >
                          {t('markAsRead')}
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {(canLoadMore || isLoadingMore) && (
          <div className="border-border border-t p-2">
            <Button
              size="sm"
              variant="ghost"
              className="w-full"
              disabled={!canLoadMore}
              onClick={() => loadMore(LOAD_MORE_NUM_ITEMS)}
            >
              {isLoadingMore ? t('loading') : t('loadMore')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
