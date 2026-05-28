'use client';

import { Popover } from '@tale/ui/popover';
import { Bell } from 'lucide-react';
import { useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useNotificationsUnreadCount } from '../hooks/queries';
import { NotificationListPanel } from './notification-list-panel';

interface NotificationBellProps {
  organizationId: string;
  /** Show a text label next to the bell (mobile nav uses this). */
  label?: string;
}

export function NotificationBell({
  organizationId,
  label,
}: NotificationBellProps) {
  const { t: tNav } = useT('navigation');
  const [open, setOpen] = useState(false);
  const { data: unread } = useNotificationsUnreadCount(organizationId);
  const unreadCount = unread ?? 0;

  const trigger = (
    <button
      type="button"
      aria-label={tNav('notifications')}
      className={cn(
        'hover:bg-muted relative flex items-center rounded-lg transition-colors cursor-pointer',
        label ? 'gap-3 px-3 py-2 w-full' : 'justify-center p-2',
      )}
    >
      <span className="relative inline-flex">
        <Bell className="text-muted-foreground size-5 shrink-0" />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="bg-destructive text-destructive-foreground absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </span>
      {label && <span className="text-sm font-medium">{label}</span>}
    </button>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      side="right"
      sideOffset={8}
      contentClassName="bg-card w-96 max-w-[calc(100vw-2rem)] p-0"
      trigger={trigger}
    >
      <NotificationListPanel
        organizationId={organizationId}
        className="h-[28rem]"
      />
    </Popover>
  );
}
