import { Row, Stack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonCircle } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

import { readSidebarExpandedHint } from './sidebar-context';

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

/** One masked 36×36 icon tile (logo/toggle/search/nav/bell slots). */
function TileSkeleton() {
  return (
    <Row gap={0} justify="center" className="size-9 shrink-0">
      <SkeletonBox>
        <div className="size-5" />
      </SkeletonBox>
    </Row>
  );
}

/** One masked nav row — mirrors SidebarNavItem's expanded footprint. */
function NavRowSkeleton({ labelWidth }: { labelWidth: string }) {
  return (
    <Row gap={0} className="h-9 gap-2.5 rounded-md pr-2 pl-2">
      <SkeletonBox>
        <div className="size-5" />
      </SkeletonBox>
      <SkeletonBox>
        <div className={`h-3.5 ${labelWidth}`} />
      </SkeletonBox>
    </Row>
  );
}

/** Uppercase section-label bar (PROJECTS / CHATS). */
function SectionLabelSkeleton({ width }: { width: string }) {
  return (
    <Row gap={0} className="h-7 px-2">
      <SkeletonBox>
        <div className={`h-3 ${width}`} />
      </SkeletonBox>
    </Row>
  );
}

export interface AppSidebarPlaceholderProps {
  /**
   * Lets the skeleton read the persisted width hint. Omitted on the pre-org
   * redirect frames, which fall back to the expanded default.
   */
  organizationId?: string;
}

/**
 * Masked desktop sidebar shown while access resolves. Mirrors the unified
 * AppSidebar's geometry — header, search row, nav rows, projects/chats
 * sections, pinned footer — in whichever width the persisted per-org hint
 * suggests, so the live panel slots in without reflow in the common case.
 * Below `lg` it is always rail-width, mirroring the pinned-rail viewport
 * behaviour of the live sidebar.
 */
export function AppSidebarPlaceholder({
  organizationId,
}: AppSidebarPlaceholderProps) {
  const collapsed = readSidebarExpandedHint(organizationId) === false;

  if (collapsed) {
    return (
      <div className="bg-background hidden h-full w-(--sidebar-width-collapsed) shrink-0 md:flex">
        <Skeletonize loading>
          <Stack gap={0} className="h-full w-full overflow-hidden px-1.5">
            {/* Leading tile (toggle ≥lg, logo on the pinned rail) */}
            <div className="shrink-0 pt-3 pb-4">
              <TileSkeleton />
            </div>
            {/* Search tile */}
            <div className="shrink-0 pb-0.5">
              <TileSkeleton />
            </div>
            {/* Nav tiles */}
            <Stack gap={0} className="shrink-0 gap-0.5">
              {Array.from({ length: PLACEHOLDER_NAV_ITEMS }, (_, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <TileSkeleton key={i} />
              ))}
            </Stack>
            {/* Clipped chats region keeps the footer pinned to the bottom */}
            <div className="border-border mt-2 min-h-0 flex-1 border-t" />
            {/* Footer: bell + account tiles */}
            <Stack
              gap={0}
              className="border-border shrink-0 gap-0.5 border-t py-2"
            >
              <TileSkeleton />
              <Row gap={0} justify="center" className="size-9 shrink-0">
                <SkeletonCircle>
                  <div className="size-5" />
                </SkeletonCircle>
              </Row>
            </Stack>
          </Stack>
        </Skeletonize>
      </div>
    );
  }

  return (
    // Rail-width below `lg` (where the live sidebar is pinned collapsed),
    // expanded-width from `lg` up — mirrors AppSidebar's viewport behaviour.
    <div className="bg-background hidden h-full w-(--sidebar-width-collapsed) shrink-0 md:flex lg:w-(--sidebar-width)">
      <Skeletonize loading>
        <Stack gap={0} className="h-full w-full overflow-hidden">
          {/* Header: logo tile + workspace name + collapse toggle */}
          <div className="shrink-0 px-1.5 pt-3 pb-4">
            <Row gap={0} className="h-9 gap-2.5">
              <TileSkeleton />
              <Row gap={0} justify="center" className="min-w-0 flex-1">
                <SkeletonBox>
                  <div className="h-4 w-24" />
                </SkeletonBox>
              </Row>
              <TileSkeleton />
            </Row>
          </div>
          {/* Search row */}
          <div className="shrink-0 px-1.5 pb-0.5">
            <SkeletonBox fullWidth>
              <div className="h-9 rounded-md" />
            </SkeletonBox>
          </div>
          {/* Primary nav rows */}
          <Stack gap={0} className="shrink-0 gap-0.5 px-1.5">
            {NAV_LABEL_WIDTHS.slice(0, PLACEHOLDER_NAV_ITEMS).map(
              (labelWidth, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <NavRowSkeleton key={i} labelWidth={labelWidth} />
              ),
            )}
          </Stack>
          {/* Chats region — mirrors ChatHistorySidebar's own skeleton rhythm:
              PROJECTS label + a folder row, divider, CHATS label + rows */}
          <Stack
            gap={0}
            className="border-border mt-2 min-h-0 flex-1 gap-0.5 overflow-hidden border-t px-2.5 pt-2.5 pb-3.5"
          >
            <SectionLabelSkeleton width="w-16" />
            <Row gap={0} className="h-8 gap-1.5 px-2">
              <SkeletonBox>
                <div className="size-3.5 rounded-sm" />
              </SkeletonBox>
              <SkeletonBox>
                <div className="size-3 rounded-sm" />
              </SkeletonBox>
              <SkeletonBox>
                <div className="h-3.5 w-24" />
              </SkeletonBox>
            </Row>
            <div aria-hidden className="border-border mt-1.5 mb-2 border-t" />
            <SectionLabelSkeleton width="w-12" />
            {Array.from({ length: 5 }).map((_, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <Row key={i} gap={0} className="h-8 px-2">
                <div style={{ width: `${82 - (i % 4) * 14}%` }}>
                  <SkeletonBox fullWidth>
                    <div className="h-3.5" />
                  </SkeletonBox>
                </div>
              </Row>
            ))}
          </Stack>
          {/* Pinned footer: bell tile + account row */}
          <Stack
            gap={0}
            className="border-border shrink-0 gap-0.5 border-t px-1.5 py-2"
          >
            <TileSkeleton />
            <Row gap={0} className="h-9 gap-2.5 pr-2 pl-2">
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
