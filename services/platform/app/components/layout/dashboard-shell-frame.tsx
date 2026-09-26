import { Row, Stack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonCircle } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

import { AppSidebarPlaceholder } from './app-sidebar/app-sidebar-placeholder';
// Relative imports on purpose: this module also runs under plain `bun`
// (the boot-shell prerender), where the `@/` tsconfig alias isn't guaranteed.
import { ChatComposerPlaceholder } from './chat-composer-placeholder';
import { HomePanelPlaceholder } from './home-panel-placeholder';
import { MobileBottomNavPlaceholder } from './mobile-bottom-nav-placeholder';

/**
 * KEEP THIS MODULE LEAN. It is the boot-shell prerender root (rendered under
 * plain `bun` at build time) — imports must stay framework-free: @tale/ui
 * layout/skeleton primitives and the placeholder only.
 */

/**
 * Full-frame dashboard chrome for the redirect routes (`/dashboard`,
 * `/dashboard/create-organization`) that have no Outlet/nav of their own and
 * just need the shell to show while they resolve which org to route to — and
 * the markup the boot-shell prerender bakes into `index.html`, so the first
 * HTML paint already shows this exact frame. Mirrors the resolved layout's
 * outer frame so the real chrome slots in without reflow.
 */
export function DashboardShellFrame() {
  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden md:flex-row">
      {/* Mobile top bar — mirrors the resolved chat header (the default
          landing): a leading cluster of action icons + the trailing account
          avatar, so the real header slots in without reflow. Matches the
          DashboardLayout header geometry (px-4, min-h-12). */}
      <div className="bg-background border-border border-b px-4 pt-(--safe-top) md:hidden">
        <Skeletonize loading>
          <Row gap={2} className="min-h-12">
            {/* Leading action icons (sidebar menu / search). */}
            <Row gap={0} align="stretch" className="flex-1">
              {Array.from({ length: 2 }, (_, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <Row key={i} gap={0} justify="center" className="p-2">
                  <SkeletonBox>
                    <div className="size-5" />
                  </SkeletonBox>
                </Row>
              ))}
            </Row>
            {/* Trailing account avatar (UserButton). */}
            <Row gap={0} justify="center" className="p-2">
              <SkeletonCircle>
                <div className="size-5" />
              </SkeletonCircle>
            </Row>
          </Row>
        </Skeletonize>
      </div>

      {/* Desktop sidebar */}
      <AppSidebarPlaceholder />

      <Stack
        as="main"
        gap={0}
        className="border-border bg-background min-h-0 min-w-0 flex-1 overflow-hidden md:border-l"
      >
        {/* Home layout stand-ins — the row mirrors the Home frame (the
            panel beside the page, a chat's composer at the column's foot),
            so the real page slots in without reflow. Each piece shows itself
            in CSS only (`boot-home-panel-open` on a Home route, `boot-chat`
            on a chat route, on <html>); on every other route the row renders
            empty, keeping the shell's single variant. */}
        <div className="flex min-h-0 flex-1 flex-row">
          <HomePanelPlaceholder />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ChatComposerPlaceholder />
          </div>
        </div>
      </Stack>

      {/* Mobile bottom-nav placeholder — the live tab bar's exact height, so
          the composer stand-in above it sits where the live composer lands. */}
      <MobileBottomNavPlaceholder />
    </div>
  );
}
