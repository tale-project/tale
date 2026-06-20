'use client';

import { Card } from '@tale/ui/card';
import { Grid } from '@tale/ui/layout';
import { type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * Shared catalog UI — one compact, equal-height card and the responsive grid
 * that lays them out. Used by every "browse and act" surface (the integrations,
 * agents, and automations catalogs) so they stay visually identical.
 *
 * Why a dedicated card instead of `<Card>` directly: the `Card` primitive wraps
 * its children in a `p-6` content box, so callers that ALSO padded the outer
 * frame (the old agent catalog did `<Card className="p-4">`) double-padded and
 * the cards ballooned. `CatalogCard` owns a single `p-4` content box and slots
 * (media, title, badge, description, meta, actions), keeping every catalog card
 * sized to its content.
 */

/** Responsive catalog grid: 1 → 2 (sm) → 3 (lg) columns. */
export function CatalogGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Grid cols={1} sm={2} lg={3} gap={4} className={className}>
      {children}
    </Grid>
  );
}

/**
 * A 40px bordered media tile for a catalog card (brand glyph, icon, or avatar),
 * so icon sizing is identical across catalogs. Render an `<img>`/`<Icon>` (≈24px)
 * inside it.
 */
export function CatalogCardIcon({ children }: { children: ReactNode }) {
  return (
    <span className="border-border bg-background flex size-10 shrink-0 items-center justify-center rounded-lg border">
      {children}
    </span>
  );
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
        <div className="mt-3 flex flex-wrap items-center gap-1.5">{meta}</div>
      ) : null}
      {actions ? (
        <div className="mt-auto flex items-center gap-2 pt-4">{actions}</div>
      ) : null}
    </>
  );

  const frameClass = cn(
    'h-full',
    interactive && 'hover:border-primary/50 transition-colors',
    active && 'border-primary/50',
    className,
  );

  if (interactive) {
    return (
      <Card className={frameClass} contentClassName="h-full p-0">
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={ariaLabel}
          className="focus-visible:ring-ring flex h-full w-full flex-col p-4 text-left outline-none focus-visible:ring-2 disabled:opacity-50"
        >
          {inner}
        </button>
      </Card>
    );
  }

  return (
    <Card className={frameClass} contentClassName="flex h-full flex-col p-4">
      {inner}
    </Card>
  );
}
