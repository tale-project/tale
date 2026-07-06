'use client';

import { Card, CardGrid, CardMedia } from '@tale/ui/card';
import { type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

/** Dark-mode fill — matches elevated panels (`bg-card`, same as dropdowns). */
const catalogCardSurfaceClass = 'dark:bg-card';

/**
 * Shared catalog UI — one compact, equal-height card and the responsive grid
 * that lays them out. Used by every "browse and act" surface (the integrations,
 * agents, and automations catalogs) so they stay visually identical.
 *
 * `CatalogCard` is the catalog-specific composition of the `@tale/ui/card`
 * primitive: a single `padding="md"` box with the catalog slots (media, title,
 * badge, description, meta, actions). The grid and media tile delegate straight
 * to the shared `CardGrid` / `CardMedia` so every catalog stays aligned with the
 * rest of the app's cards.
 */

/** Responsive catalog grid: 1 → 2 (sm) → 3 (lg) columns. */
export function CatalogGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <CardGrid className={className}>{children}</CardGrid>;
}

/**
 * A 40px bordered media tile for a catalog card (brand glyph, icon, or avatar),
 * so icon sizing is identical across catalogs. Render an `<img>`/`<Icon>` (≈24px)
 * inside it. Thin alias over the shared `CardMedia`.
 */
export function CatalogCardIcon({ children }: { children: ReactNode }) {
  return <CardMedia>{children}</CardMedia>;
}

interface CatalogCardProps {
  /** Leading media tile (use `CatalogCardIcon`). Optional. */
  media?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Top-right status / category badge. */
  badge?: ReactNode;
  /** Meta row under the description: tags, requirement chips, brand icons. */
  meta?: ReactNode;
  /**
   * Footer actions (buttons). When present the card is a static container so the
   * buttons own the clicks; `onClick` is then ignored (no nested buttons).
   */
  actions?: ReactNode;
  /** Makes the whole card a button (only when there are no `actions`). */
  onClick?: () => void;
  disabled?: boolean;
  /** Selected/active emphasis (e.g. the template being installed). */
  active?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function CatalogCard({
  media,
  title,
  description,
  badge,
  meta,
  actions,
  onClick,
  disabled,
  active,
  ariaLabel,
  className,
}: CatalogCardProps) {
  const interactive = Boolean(onClick) && !actions;

  const inner = (
    <>
      <div className="flex items-start gap-3">
        {media ? <div className="shrink-0">{media}</div> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <span className="text-foreground line-clamp-1 text-sm font-medium">
              {title}
            </span>
            {badge ? <span className="shrink-0">{badge}</span> : null}
          </div>
          {description ? (
            <p className="text-muted-foreground line-clamp-2 text-sm leading-snug">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {meta ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">{meta}</div>
      ) : null}
      {actions ? (
        <div className="mt-auto flex items-center justify-end gap-2 pt-3">
          {actions}
        </div>
      ) : null}
    </>
  );

  if (interactive) {
    return (
      <Card
        asChild
        interactive
        padding="md"
        className={cn(
          'h-full',
          catalogCardSurfaceClass,
          active && 'ring-2 ring-primary',
          className,
        )}
      >
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={ariaLabel}
          className="flex h-full w-full flex-col text-left disabled:opacity-50"
        >
          {inner}
        </button>
      </Card>
    );
  }

  return (
    <Card
      padding="md"
      className={cn(
        'flex h-full flex-col',
        catalogCardSurfaceClass,
        active && 'ring-2 ring-primary',
        className,
      )}
    >
      {inner}
    </Card>
  );
}
