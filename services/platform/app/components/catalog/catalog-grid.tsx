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
 * automations, connectors, and skills catalogs) so they stay visually
 * identical.
 *
 * `CatalogCard` is the catalog-specific composition of the `@tale/ui/card`
 * primitive: a single `padding="md"` box with the catalog slots (media, title,
 * badge, meta, description, actions). The grid and media tile delegate straight
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
   * Sits under the icon+title row and left-aligns with the icon edge
   * (full-bleed body), not indented beside the media tile — keeps the card
   * visually balanced. Badges and chips belong in `badge` / `meta` — an
   * element inside the description is invalid HTML. The two-line box is
   * RESERVED even when absent/short, so cards never stagger.
   */
  description?: ReactNode;
  /** Top-right slot — owns the card's status badge(s). Its row height is
   *  reserved either way. */
  badge?: ReactNode;
  /**
   * Meta row directly under the title — quiet labels / requirement cues.
   * Scan order is title → meta → description. The row is reserved even when
   * empty, so labelled and unlabelled cards share one anatomy.
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
   * with no `actions` (the card's interactive form). Rendered top-right so it
   * balances the icon and doesn't leave a hollow band under the description,
   * as a SIBLING of the card's button, so a real interactive control never
   * nests inside another button (invalid HTML / an a11y violation) — same
   * pattern as `McpServerCard`.
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
      {/* Readable scan: icon + title/meta on one row; description full-bleed
          under that row, left edge flush with the icon (not indented into the
          text column) so hierarchy stays balanced. */}
      <div className="flex items-start gap-3">
        {media ? <div className="shrink-0">{media}</div> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Every slot RESERVES its space (`min-h-*`) whether or not the card
              fills it — a card with no badge or no labels must render the
              same anatomy as its densest neighbor, so a grid row never
              staggers. */}
          {/* FIXED height (`h-6.5` = a Badge's outer box) with vertical
              centering — the title must sit at the same y whether or not a
              badge is present, and the row must never grow. */}
          <div className="flex h-6.5 items-center justify-between gap-2">
            <span className="text-foreground line-clamp-1 text-sm font-medium tracking-tight">
              {title}
            </span>
            {badge ? <span className="shrink-0">{badge}</span> : null}
          </div>
          <div className="flex min-h-4 items-center">{meta}</div>
        </div>
      </div>
      {/* Clear band break under the icon+title header so the full-bleed
          description doesn't feel jammed into the meta line. */}
      <p className="text-muted-foreground mt-3 line-clamp-2 min-h-[2lh] text-sm leading-snug">
        {description}
      </p>
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
          // Reserve the top-right for the overlaid ⋯ so title/badge never sit
          // under it.
          menu && 'pr-10',
          active && 'ring-2 ring-primary',
          className,
        )}
      >
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={ariaLabel}
          className="flex h-full w-full cursor-pointer flex-col text-left disabled:cursor-not-allowed disabled:opacity-50"
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
        <div className="absolute top-3 right-3 z-10">{menu}</div>
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
