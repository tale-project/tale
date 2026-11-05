import { BottomTabBarPlaceholder } from '@tale/ui/bottom-tab-bar';
import { Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

/*
 * KEEP THIS MODULE LEAN. The build renders it under plain `bun`
 * (`boot-shell.tsx`, `scripts/prerender-boot-shell.ts`): its imports stay the
 * layout, skeleton and placeholder primitives of `@tale/ui`.
 */

/** The sections at the top of the rail (`useNavItems`): Sessions, Proxies, Secrets. Keep in step. */
const RAIL_SECTIONS = 3;
/** The phone's tabs: the sections, and Settings from the foot of the rail. */
const PHONE_TABS = RAIL_SECTIONS + 1;

/** The masked logo of the rail, in the box of its link. */
function LogoTile() {
  return (
    <div className="flex size-9 items-center justify-center">
      <SkeletonBox asChild>
        <div className="size-5 rounded-sm" />
      </SkeletonBox>
    </div>
  );
}

/** A masked tile of the rail, in the boxes a tile of `RailList` has. */
function NavTile() {
  return (
    <li>
      <span className="inline-block">
        <div className="flex size-9 items-center justify-center">
          <SkeletonBox asChild>
            <div className="size-5 rounded-sm" />
          </SkeletonBox>
        </div>
      </span>
    </li>
  );
}

/**
 * The frame of every page (`AppFrame`) before the app has drawn it: the rail
 * with its tiles masked on a computer, the tab bar with its tabs masked on a
 * phone, and an empty page beside them. The build puts it into `#root`, so the
 * first paint is the app's frame rather than a blank page, and React's first
 * commit puts the page in its place. Every box mirrors the one of the live
 * frame (`AppFrame`, `AppRail`, `RailList`), so the frame does not move when
 * the app takes over, as the platform's boot shell mirrors its own
 * (`services/platform/app/components/layout/dashboard-shell-frame.tsx`).
 */
export function AppFramePlaceholder() {
  return (
    <div className="mobile-nav-shell flex h-dvh w-full flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <div className="bg-background hidden h-full w-(--sidebar-width-collapsed) shrink-0 md:flex">
          <Skeletonize loading className="h-full w-full">
            <Stack gap={0} className="h-full w-full overflow-hidden px-2">
              <div className="shrink-0 pt-3 pb-4">
                <LogoTile />
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-hidden">
                  <ul className="flex list-none flex-col gap-2">
                    {Array.from({ length: RAIL_SECTIONS }, (_, index) => (
                      // eslint-disable-next-line react/no-array-index-key -- a fixed column of identical masks
                      <NavTile key={index} />
                    ))}
                  </ul>
                </div>
                <div className="border-border shrink-0 border-t py-2">
                  <ul className="flex list-none flex-col gap-2">
                    <NavTile />
                  </ul>
                </div>
              </div>
            </Stack>
          </Skeletonize>
        </div>
        <div className="border-border bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:border-l" />
        <BottomTabBarPlaceholder tabs={PHONE_TABS} />
      </div>
    </div>
  );
}
