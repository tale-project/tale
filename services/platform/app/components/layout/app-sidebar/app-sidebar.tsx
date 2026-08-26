'use client';

import { Stack } from '@tale/ui/layout';

import { ChatSearchCommand } from '@/app/features/chat/components/chat-search-command';
import { useT } from '@/lib/i18n/client';

import { MobileSidebarSheet } from './mobile-sidebar-sheet';
import { SidebarFooter } from './sidebar-footer';
import { SidebarHeader } from './sidebar-header';
import { SidebarNav } from './sidebar-nav';
import { SidebarSearchCommand } from './sidebar-search-command';
import { SidebarSearchTrigger } from './sidebar-search-trigger';

export interface AppSidebarProps {
  organizationId: string;
}

/**
 * The app sidebar: a permanent 52px icon rail of primary destinations,
 * present on every dashboard route (chat search + history live in the chat
 * route's sub-panel — see ChatSubPanel; a section's labelled navigation
 * lives in its own sub-panel, like the settings rail). Every tile carries
 * its label as an `aria-label` with a right-side tooltip. Hidden below `md`,
 * where the mobile drawer takes over.
 *
 * Also mounts the surfaces that must exist on every route regardless of
 * viewport: the mobile drawer and the ⌘K palette.
 */
export function AppSidebar({ organizationId }: AppSidebarProps) {
  const { t: tNav } = useT('navigation');

  return (
    <>
      <aside
        aria-label={tNav('sidebar.landmark')}
        className="bg-background hidden h-full w-(--sidebar-width-collapsed) shrink-0 md:flex"
      >
        <Stack gap={0} className="h-full w-full overflow-hidden px-2">
          <div className="shrink-0 pt-3 pb-4">
            <SidebarHeader organizationId={organizationId} />
          </div>
          <div className="flex shrink-0 justify-center pb-2">
            <SidebarSearchTrigger />
          </div>
          {/* The nav region flexes and scrolls (scrollbar hidden — the rail
              is too narrow for one) so a short viewport never clips tiles;
              its flex-1 also pins the footer to the bottom. */}
          <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto">
            <SidebarNav organizationId={organizationId} />
          </div>
          <SidebarFooter organizationId={organizationId} />
        </Stack>
      </aside>
      <MobileSidebarSheet organizationId={organizationId} />
      <SidebarSearchCommand organizationId={organizationId} />
      <ChatSearchCommand organizationId={organizationId} />
    </>
  );
}
