'use client';

import { Stack } from '@tale/ui/layout';

import { useT } from '@/lib/i18n/client';

import { SidebarFooter } from './sidebar-footer';
import { SidebarHeader } from './sidebar-header';
import { SidebarNav } from './sidebar-nav';
import { SidebarSearchCommand } from './sidebar-search-command';
import { SidebarSearchTrigger } from './sidebar-search-trigger';

export interface AppSidebarProps {
  organizationId: string;
}

/**
 * The app sidebar: a permanent 52px icon rail of the sections — Home,
 * Knowledge, Automations, with Settings, notifications and the account at
 * its foot — present on every dashboard route. A section's own navigation
 * lives in its panel beside the page (the Home panel, the Settings panel).
 * Every tile carries its label as an `aria-label` with a right-side tooltip.
 * Hidden below `md`, where the bottom tab bar takes over.
 *
 * Also mounts the surface that must exist on every route regardless of
 * viewport: the shared search palette.
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
      <SidebarSearchCommand organizationId={organizationId} />
    </>
  );
}
