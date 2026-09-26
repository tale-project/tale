import { Row, Stack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonCircle } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

/**
 * KEEP THIS MODULE LEAN. The boot-shell prerender script renders it under
 * plain `bun` at build time — imports must stay framework-free (@tale/ui
 * layout/skeleton primitives only).
 */

// The sections of the `primary` list in `use-navigation-items.ts` — Home,
// Knowledge, Automations. Keep in step; Settings is pinned to the footer.
const PLACEHOLDER_NAV_ITEMS = 3;

/** One masked 36×36 icon tile (logo/nav/bell slots). */
function TileSkeleton() {
  return (
    <Row gap={0} justify="center" className="size-9 shrink-0">
      <SkeletonBox asChild>
        <div className="size-5 rounded-sm" />
      </SkeletonBox>
    </Row>
  );
}

/**
 * Masked desktop rail shown while access resolves. Mirrors the AppSidebar's
 * fixed 52px icon rail — logo tile, nav tiles, pinned footer — so the live
 * rail slots in without reflow. Hidden below `md`, like the live rail.
 */
export function AppSidebarPlaceholder() {
  return (
    <div className="bg-background hidden h-full w-(--sidebar-width-collapsed) shrink-0 md:flex">
      <Skeletonize loading>
        <Stack gap={0} className="h-full w-full overflow-hidden px-2">
          {/* Header: logo tile */}
          <div className="shrink-0 pt-3 pb-4">
            <TileSkeleton />
          </div>
          <div className="flex shrink-0 justify-center pb-2">
            <TileSkeleton />
          </div>
          {/* Nav tiles — same flexing scroll region as the live rail, so the
              footer pins to the bottom and short viewports clip nothing. */}
          <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto">
            <Stack gap={0} className="gap-2">
              {Array.from({ length: PLACEHOLDER_NAV_ITEMS }, (_, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <TileSkeleton key={i} />
              ))}
            </Stack>
          </div>
          {/* Footer: bell + Settings + account tiles */}
          <Stack gap={0} className="border-border shrink-0 gap-2 border-t py-2">
            <TileSkeleton />
            <TileSkeleton />
            <Row gap={0} justify="center" className="size-9 shrink-0">
              <SkeletonCircle asChild>
                <div className="size-5 rounded-full" />
              </SkeletonCircle>
            </Row>
          </Stack>
        </Stack>
      </Skeletonize>
    </div>
  );
}
