'use client';

import { Bell, ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Popover } from '@/app/components/ui/overlays/popover';
import { Button } from '@/app/components/ui/primitives/button';
import { useFormatDate } from '@/app/hooks/use-format-date';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-guards';

import { useMarkNotificationRead } from '../hooks/mutations';
import {
  useNotificationsList,
  useNotificationsUnreadCount,
} from '../hooks/queries';

interface NotificationBellProps {
  organizationId: string;
}

const SEVERITY_DOT: Record<string, string> = {
  info: 'bg-sky-500',
  warning: 'bg-amber-500',
  critical: 'bg-red-500',
};

// Strip a leading `notifications.` namespace prefix that was accidentally
// stored in earlier rows — we already bind the namespace with
// useT('notifications'), so a prefixed key resolves to nothing.
function stripNsPrefix(key: string): string {
  return key.startsWith('notifications.')
    ? key.slice('notifications.'.length)
    : key;
}

export function NotificationBell({ organizationId }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<Id<'notifications'> | null>(
    null,
  );
  const { t } = useT('notifications');
  const { formatRelative, formatDate } = useFormatDate();

  const { data: list } = useNotificationsList(organizationId);
  const { data: unread } = useNotificationsUnreadCount(organizationId);
  const markRead = useMarkNotificationRead();

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
      void markRead.mutateAsync({ notificationId });
    },
    [markRead],
  );

  const items = list?.page ?? [];
  const unreadCount = unread ?? 0;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      side="right"
      contentClassName="w-96 max-w-[24rem] p-0"
      trigger={
        <button
          type="button"
          aria-label={t('ariaLabel')}
          title={t('tooltip')}
          className="hover:bg-muted relative flex size-9 items-center justify-center rounded-lg transition-colors"
        >
          <Bell className="text-muted-foreground size-5" />
          {unreadCount > 0 && (
            <span
              aria-label={t('unreadCount', { count: unreadCount })}
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      }
    >
      <div className="flex max-h-[32rem] flex-col">
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">{t('title')}</span>
          {unreadCount > 0 && (
            <span className="text-muted-foreground text-xs">
              {t('unreadCount', { count: unreadCount })}
            </span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="text-muted-foreground px-4 py-8 text-center text-sm">
              {t('empty')}
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
        </div>
      </div>
    </Popover>
  );
}
