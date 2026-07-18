import { Row, Stack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonCircle } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

// The real list is CASL-gated down to a few items and the gated count isn't
// known until access resolves, so the placeholder optimistically renders the
// whole set — a pixel match for the common admin/owner case that only
// over-draws a slot or two for limited members.
const PLACEHOLDER_NAV_ITEMS = 7;

// Label bars vary like real nav labels so the column doesn't read as a comb.
const NAV_LABEL_WIDTHS = [
  'w-16',
  'w-14',
  'w-20',
  'w-12',
  'w-24',
  'w-14',
  'w-16',
];

/** One masked nav row — mirrors SidebarNavItem's expanded footprint. */
function NavRowSkeleton({ labelWidth }: { labelWidth: string }) {
  return (
    <Row gap={0} className="h-8 gap-2.5 rounded-md pr-2 pl-1.5">
      <SkeletonBox>
        <div className="size-5" />
      </SkeletonBox>
      <SkeletonBox>
        <div className={`h-3.5 ${labelWidth}`} />
      </SkeletonBox>
    </Row>
  );
}

/**
 * Masked desktop sidebar shown while access resolves. Mirrors the unified
 * AppSidebar's default-expanded geometry — header, search row, nav rows, chats
 * region, pinned footer — so the live panel slots in without reflow. (A user
 * whose persisted preference is collapsed sees this settle from 18rem to the
 * rail once the live sidebar mounts — the per-user key isn't knowable before
 * auth resolves, and default-expanded is the common case.)
 */
export function AppSidebarPlaceholder() {
  return (
    <div className="bg-background hidden h-full w-(--sidebar-width) shrink-0 md:flex">
      <Skeletonize loading>
        <Stack gap={0} className="h-full w-full overflow-hidden">
          {/* Header: logo box + workspace name + collapse toggle */}
          <div className="shrink-0 px-3 pt-3 pb-2">
            <Row gap={0} className="h-8 gap-2.5">
              <Row gap={0} justify="center" className="size-8 shrink-0">
                <SkeletonBox>
                  <div className="size-5" />
                </SkeletonBox>
              </Row>
              <div className="min-w-0 flex-1">
                <SkeletonBox>
                  <div className="h-4 w-24" />
                </SkeletonBox>
              </div>
              <Row gap={0} justify="center" className="size-8 shrink-0">
                <SkeletonBox>
                  <div className="size-5" />
                </SkeletonBox>
              </Row>
            </Row>
          </div>
          {/* Search row */}
          <div className="shrink-0 px-3 pb-2">
            <SkeletonBox fullWidth>
              <div className="h-8 rounded-md" />
            </SkeletonBox>
          </div>
          {/* Primary nav rows */}
          <Stack gap={0} className="shrink-0 gap-0.5 px-3">
            {NAV_LABEL_WIDTHS.slice(0, PLACEHOLDER_NAV_ITEMS).map(
              (labelWidth, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <NavRowSkeleton key={i} labelWidth={labelWidth} />
              ),
            )}
          </Stack>
          {/* Chats region — approximates ChatHistorySidebar's own skeleton
              (section label + rows) so its real skeleton slots in seamlessly */}
          <Stack
            gap={1}
            className="border-border mt-2 min-h-0 flex-1 overflow-hidden border-t px-2.5 py-3.5"
          >
            <Row gap={0} className="h-7 px-2">
              <SkeletonBox>
                <div className="h-3 w-16" />
              </SkeletonBox>
            </Row>
            {Array.from({ length: 6 }).map((_, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <Row key={i} gap={0} className="min-h-[1.5rem] px-2 py-1.5">
                <div style={{ width: `${82 - (i % 4) * 14}%` }}>
                  <SkeletonBox fullWidth>
                    <div className="h-3.5" />
                  </SkeletonBox>
                </div>
              </Row>
            ))}
          </Stack>
          {/* Pinned footer: bell tile + account row */}
          <Stack gap={1} className="border-border shrink-0 border-t px-3 py-2">
            <Row gap={0} justify="center" className="size-8">
              <SkeletonBox>
                <div className="size-5" />
              </SkeletonBox>
            </Row>
            <Row gap={0} className="h-8 gap-2.5 pr-2 pl-1.5">
              <SkeletonCircle>
                <div className="size-5" />
              </SkeletonCircle>
              <SkeletonBox>
                <div className="h-3.5 w-20" />
              </SkeletonBox>
            </Row>
          </Stack>
        </Stack>
      </Skeletonize>
    </div>
  );
}
