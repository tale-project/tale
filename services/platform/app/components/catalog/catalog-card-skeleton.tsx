'use client';

import { Card } from '@tale/ui/card';
import { Row, Stack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';

import { cn } from '@/lib/utils/cn';

import { CatalogGrid } from './catalog-grid';

/**
 * Placeholder card matching the shared `CatalogCard` footprint (40px icon
 * tile, title line, badge pill, two description lines, optional footer row, and
 * an optional top-right ⋯ menu) so every catalog's loading grid occupies the
 * same height and shape as its loaded grid — no layout shift on resolve.
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
    <Card
      padding="md"
      // `relative` + `pr-10` mirror the loaded interactive card exactly when a
      // menu is present, so the ⋯ placeholder can overlay the same corner.
      className={cn('flex h-full flex-col', menu && 'relative pr-10')}
    >
      <Row gap={3} align="start">
        <SkeletonBox>
          <div className="size-10 rounded-lg" />
        </SkeletonBox>
        <Stack gap={1} className="min-w-0 flex-1 gap-0.5">
          {/* Mirrors the loaded card: title → quiet meta; description below. */}
          <Row gap={2} align="center" justify="between" className="h-6.5">
            <div className="w-28 text-sm leading-none">
              <SkeletonText />
            </div>
            <SkeletonBox>
              <div className="h-5 w-16 rounded-full" />
            </SkeletonBox>
          </Row>
          <div className="min-h-4 w-24 text-xs leading-4">
            <SkeletonText />
          </div>
        </Stack>
      </Row>
      <div className="mt-3 min-h-[2lh] text-sm leading-snug">
        <SkeletonText lines={2} />
      </div>
      {footer ? (
        <Row
          justify="between"
          align="center"
          className="mt-auto w-full gap-3 pt-4"
        >
          <SkeletonBox>
            <div className="h-5 w-20 rounded-full" />
          </SkeletonBox>
          <span className="shrink-0">
            <SkeletonBox>
              <div className="h-8 w-20 rounded-md" />
            </SkeletonBox>
          </span>
        </Row>
      ) : null}
      {menu ? (
        // Masks the loaded card's top-right ⋯ trigger (EntityRowActions' h-9
        // icon button at `top-3 right-3`) at its exact footprint.
        <div className="absolute top-3 right-3">
          <SkeletonBox>
            <div className="size-9 rounded-md" />
          </SkeletonBox>
        </div>
      ) : null}
    </Card>
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
  /** Reserve + mask each card's bottom-right overflow menu. */
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
