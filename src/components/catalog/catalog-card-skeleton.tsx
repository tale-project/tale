'use client';

import { cn } from '@tale/ui/cn';
import { SkeletonBox, SkeletonCircle, SkeletonText } from '@tale/ui/skeleton';

import { CatalogCard, CatalogCardIcon, CatalogGrid } from './catalog-grid';

/**
 * Placeholder card matching the shared `CatalogCard` footprint (40px icon
 * tile, title line, badge pill, two description lines, optional footer row, and
 * an optional top-right ⋯ menu) so every catalog's loading grid occupies the
 * same card anatomy as its loaded grid. The actual item count and text widths
 * remain unknown until the catalog arrives.
 * Decorative: the skeleton boxes are `aria-hidden`; the enclosing
 * `<Skeletonize>` owns the single status announcement.
 */
export function CatalogCardSkeleton({
  footer = false,
  menu = false,
}: {
  footer?: boolean;
  /** Reserve + mask the top-right overflow menu (matches `CatalogCard`'s `menu`). */
  menu?: boolean;
}) {
  return (
    <div className={cn('h-full', menu && 'relative')}>
      <CatalogCard
        className={menu ? 'pr-10' : undefined}
        media={
          <SkeletonBox asChild>
            <div className="rounded-lg">
              <CatalogCardIcon>{null}</CatalogCardIcon>
            </div>
          </SkeletonBox>
        }
        title={
          <span className="block w-28">
            <SkeletonText />
          </span>
        }
        badge={
          <SkeletonCircle asChild>
            <span className="block h-6.5 w-16 rounded-full" />
          </SkeletonCircle>
        }
        meta={
          <span className="block w-24 text-xs leading-4">
            <SkeletonText />
          </span>
        }
        description={<SkeletonText lines={2} />}
        actions={
          footer ? (
            <SkeletonBox asChild>
              <span className="block h-8 w-20 rounded-md" />
            </SkeletonBox>
          ) : undefined
        }
      />
      {menu ? (
        // Masks the loaded card's top-right ⋯ trigger (EntityRowActions' h-9
        // icon button at `top-3 right-3`) at its exact footprint.
        <div className="absolute top-3 right-3">
          <SkeletonBox asChild>
            <div className="size-9 rounded-md" />
          </SkeletonBox>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A full loading grid of {@link CatalogCardSkeleton}s in the shared
 * `CatalogGrid` layout. Render it inside a `<Skeletonize loading>` so the one
 * wrapper announces the loading region.
 */
export function CatalogGridSkeleton({
  cards = 6,
  footer = false,
  menu = false,
}: {
  cards?: number;
  footer?: boolean;
  /** Reserve + mask each card's top-right overflow menu. */
  menu?: boolean;
}) {
  return (
    <CatalogGrid>
      {Array.from({ length: cards }).map((_, i) => (
        <CatalogCardSkeleton key={i} footer={footer} menu={menu} />
      ))}
    </CatalogGrid>
  );
}
