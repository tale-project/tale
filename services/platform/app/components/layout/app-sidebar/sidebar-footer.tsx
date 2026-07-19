'use client';

import { Stack } from '@tale/ui/layout';

import { UserButton } from '@/app/components/user-button';
import { NotificationBell } from '@/app/features/notifications/components/notification-bell';
import { useNavigationItems } from '@/app/hooks/use-navigation-items';

import { SidebarNavItem } from './sidebar-nav';

export interface SidebarFooterProps {
  organizationId: string;
}

/**
 * Pinned rail footer: notification bell (a compact icon tile — its popover
 * explains itself), any pinned nav tiles, and the account tile. Stacked so
 * every icon sits on the same 36px column.
 */
export function SidebarFooter({ organizationId }: SidebarFooterProps) {
  const { pinned } = useNavigationItems(organizationId);

  return (
    // `align="start"` so children shrink-wrap: the bell must stay a 36px tile
    // in the icon column (stretched, its centered glyph would drift).
    <Stack
      gap={0}
      align="start"
      className="border-border shrink-0 gap-2 border-t py-2"
    >
      <NotificationBell organizationId={organizationId} />
      {pinned.length > 0 && (
        <ul role="list" className="flex list-none flex-col gap-2">
          {pinned.map((item) => (
            <SidebarNavItem key={item.href} item={item} />
          ))}
        </ul>
      )}
      <UserButton sidebarExpanded={false} />
    </Stack>
  );
}
