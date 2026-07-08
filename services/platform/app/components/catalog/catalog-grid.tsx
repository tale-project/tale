'use client';

import { Slot } from '@radix-ui/react-slot';
import { Card, CardGrid, CardMedia } from '@tale/ui/card';
import { type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

/** Dark-mode fill — matches elevated panels (`bg-card`, same as dropdowns). */
const catalogCardSurfaceClass = 'dark:bg-card';

/**
 * Shared catalog UI — one compact, equal-height card and the responsive grid
 * that lays them out. Used by the card-based "browse and act" surfaces (the
 * automations, integrations, and skills catalogs) so they stay visually
 * identical.
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
 * inside it. Thin alias over the shared `CardMedia`, tinted `bg-muted` so the
 * glyph reads as a distinct chip against the card surface (`bg-bg-base`) — a
 * clearer icon/content hierarchy, and a friendlier backdrop for brand logos in
 * dark mode than the near-black base.
 */
export function CatalogCardIcon({ children }: { children: ReactNode }) {
  return <CardMedia className="bg-muted">{children}</CardMedia>;
}

interface CatalogCardProps {
  /** Leading media tile (use `CatalogCardIcon`). Optional. */
  media?: ReactNode;
  title: ReactNode;
  /**
   * TEXT-ONLY summary (it renders inside a `<p>` and clamps to two lines).
   * Badges, label chips, and any other block content belong in the `badge` /
   * `meta` slots — an element inside the description is invalid HTML.
   */
  description?: ReactNode;
  /** Top-right slot — owns the card's status badge(s). */
  badge?: ReactNode;
  /**
   * Meta row under the description — owns the card's label/requirement chips
   * (e.g. `LabelBadges`, provenance chips). Never fold these into
   * `description` or the `actions` footer.
   */
  meta?: ReactNode;
  /**
   * Footer actions (buttons). When present the card is a static container so the
   * buttons own the clicks; `onClick` is then ignored (no nested buttons).
   */
  actions?: ReactNode;
  /**
   * Makes the whole card navigate: a single link element (e.g. a router
   * `<Link>` carrying an `aria-label` for its accessible name) stretched over
   * the card as an overlay. Unlike `onClick`, this composes with `actions` —
   * the footer stays operable above the overlay (a link can't nest buttons,
   * so the overlay sits underneath them). Ignored on the `onClick` button card.
   */
  link?: ReactNode;
  /** Makes the whole card a button (only when there are no `actions`). */
  onClick?: () => void;
  disabled?: boolean;
  /** Selected/active emphasis (e.g. the template being installed). */
  active?: boolean;
  ariaLabel?: string;
  className?: string;
  /**
   * A corner ⋯ menu overlaid OUTSIDE the card's own click target — for a card
   * that's both a click target (`onClick`) and carries row-level actions (e.g.
   * an install/reinstall/uninstall menu). Only meaningful alongside `onClick`
   * with no `actions` (the card's interactive form). Rendered bottom-right, as
   * a SIBLING of the card's button, so a real interactive control never nests
   * inside another button (invalid HTML / an a11y violation) — same pattern as
   * `McpServerCard`.
   */
  menu?: ReactNode;
}

export function CatalogCard({
  media,
  title,
  description,
  badge,
  meta,
  actions,
  link,
  onClick,
  disabled,
  active,
  ariaLabel,
  className,
  menu,
}: CatalogCardProps) {
  const interactive = Boolean(onClick) && !actions;

  const inner = (
    <>
      <div className="flex items-start gap-3">
        {media ? <div className="shrink-0">{media}</div> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <span className="text-foreground line-clamp-1 text-sm font-medium tracking-tight">
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
        // `relative` lifts the footer above the stretched `link` overlay
        // (positioned siblings paint in DOM order), keeping every action
        // clickable on a linked card.
        <div className="relative mt-auto flex items-center justify-end gap-2 pt-3">
          {actions}
        </div>
      ) : null}
    </>
  );

  if (interactive) {
    const card = (
      <Card
        asChild
        interactive
        padding="md"
        className={cn(
          // On hover the interactive card lifts: the `interactive` variant
          // already strengthens the border; add the semantic card-hover shadow
          // (the base Card transitions box-shadow) so a clickable card reads as
          // raisable. Rest stays flat, matching the app's other surfaces.
          'h-full hover:shadow-card-hover',
          catalogCardSurfaceClass,
          // Reserve room for the overlaid corner menu so it never sits on top
          // of the card's own content (badge/meta chips).
          menu && 'pb-10',
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
    if (!menu) return card;
    return (
      <div className="relative h-full">
        {card}
        {/* The menu is a SIBLING of the card button (not a descendant), so a
            click on it never bubbles into the card's own `onClick` —
            `stopPropagation` isn't needed here (contrast `McpServerCard`,
            which adds one defensively on its own trigger button — a plain
            wrapping `div` with a click handler would trip the a11y
            static-element-interactions lint anyway). */}
        <div className="absolute right-3 bottom-3 z-10">{menu}</div>
      </div>
    );
  }

  return (
    <Card
      padding="md"
      interactive={Boolean(link)}
      className={cn(
        'flex h-full flex-col',
        link && 'relative',
        catalogCardSurfaceClass,
        active && 'ring-2 ring-primary',
        className,
      )}
    >
      {link ? (
        // Stretched-overlay link (same pattern as the conversations list): the
        // whole card is one click/tab target while the footer actions — later
        // positioned siblings — stay operable above it. The overlay carries
        // its own focus ring since focus lands on the anchor, not the card.
        <Slot className="focus-visible:ring-ring absolute inset-0 rounded-[inherit] focus-visible:ring-2 focus-visible:outline-none">
          {link}
        </Slot>
      ) : null}
      {inner}
    </Card>
  );
}
