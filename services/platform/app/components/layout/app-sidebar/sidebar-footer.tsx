'use client';

import { Stack } from '@tale/ui/layout';

import { UserButton } from '@/app/components/user-button';
import { NotificationBell } from '@/app/features/notifications/components/notification-bell';
import { useNavigationItems } from '@/app/hooks/use-navigation-items';

import { SidebarNavItem } from './sidebar-nav';

export interface SidebarFooterProps {
  organizationId: string;
  expanded: boolean;
}

/**
 * Pinned footer: notification bell (a compact icon tile in both states — its
 * popover explains itself), any pinned nav items, and the account row, which
 * widens into a labelled row while expanded. Stacked in both states so every
 * icon stays put through the transition.
 */
export function SidebarFooter({
  organizationId,
  expanded,
}: SidebarFooterProps) {
  const { pinned } = useNavigationItems(organizationId);

  return (
    // `align="start"` so children shrink-wrap: the bell must stay a 32px tile
    // in the leading icon column (stretched, its centered glyph would drift to
    // mid-panel and get clipped out entirely in the rail state).
    <Stack
      gap={0}
      align="start"
      className="border-border shrink-0 border-t px-2 py-2"
    >
      <NotificationBell organizationId={organizationId} />
      {pinned.length > 0 && (
        <ul role="list" className="flex list-none flex-col gap-0.5">
          {pinned.map((item) => (
            <SidebarNavItem key={item.href} item={item} expanded={expanded} />
          ))}
        </ul>
      )}
      <UserButton sidebarExpanded={expanded} />
    </Stack>
  );
}
