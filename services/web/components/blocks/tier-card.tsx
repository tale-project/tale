import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

const easeOut = [0.22, 1, 0.36, 1] as const;

interface TierCardProps {
  /** Tier display name (e.g. "Community", "Pro", "Quality"). */
  name: ReactNode;
  /** Highlight this tier as the recommended one (popular badge + tinted bg). */
  popular?: boolean;
  /** Localized "Popular" label. Only rendered when `popular` is true. */
  popularLabel?: ReactNode;
  /** Headline price (e.g. "CHF 299" or "Free"). */
  price: ReactNode;
  /**
   * Suffix line directly under the price (e.g. "/mo + VAT"). The slot
   * always reserves vertical space so cards line up across the row even
   * when one tier has no suffix.
   */
  priceSuffix?: ReactNode;
  /**
   * Optional small footnote rendered directly below the price suffix
   * (e.g. "Billed yearly · 2 months free"). When this prop is present
   * the slot is always rendered — pass an empty space (e.g. " ") on
   * sibling cards to keep the divider y-position aligned across the row.
   */
  priceFootnote?: ReactNode;
  /**
   * Tagline below the price. Reserves a fixed minimum height so the
   * border separating the body section starts at the same y-position
   * across every card in a row, regardless of how many lines each
   * tagline wraps to.
   */
  tagline?: ReactNode;
  /**
   * Body content (feature list, metrics, CTA, etc.) flowed below the
   * tagline. The wrapping article uses `flex flex-col gap-6` so each
   * child sits with consistent spacing — the consumer is expected to
   * mark the last child with `mt-auto` to push the CTA to the bottom.
   */
  children?: ReactNode;
  /** Stagger entrance — useful when several cards animate in sequence. */
  animationDelay?: number;
  /**
   * Render the card as inactive (e.g. Cloud view's Community card).
   * Dims the entire article so the row layout stays stable while the
   * tier reads as not-applicable for the current selection.
   */
  disabled?: boolean;
  /**
   * Localized badge text shown in the same slot as `popularLabel` when
   * `disabled` is true (e.g. "Self-hosted only"). Lets the card explain
   * *why* it's inactive without reflowing the body copy.
   */
  disabledLabel?: ReactNode;
}

/**
 * Pricing/hardware tier card. Renders the article wrapper with border
 * + animation, the header (name + optional Popular badge), the price
 * block, the tagline, and the body slot.
 *
 * Designed to be one of three cards in an `lg:grid-cols-3` row — the
 * card applies `first:border-l-0` / `lg:first:border-t-0` so it slots
 * into a parent box (`<div className="border ... overflow-hidden">`)
 * cleanly without callers having to manage border edges per index.
 */
export function TierCard({
  name,
  popular = false,
  popularLabel,
  price,
  priceSuffix,
  priceFootnote,
  tagline,
  children,
  animationDelay = 0,
  disabled = false,
  disabledLabel,
}: TierCardProps) {
  const reduceMotion = useReducedMotion();
  const fadeInitial = reduceMotion ? false : { opacity: 0, y: 24 };

  return (
    <motion.article
      aria-disabled={disabled || undefined}
      initial={fadeInitial}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10%' }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { duration: 0.5, delay: animationDelay, ease: easeOut }
      }
      className={`border-border-base relative flex flex-col gap-6 border-t p-8 first:border-t-0 sm:p-10 lg:border-t-0 lg:border-l lg:first:border-l-0 ${
        popular ? 'bg-bg-elevated' : 'bg-bg-base'
      } ${disabled ? 'opacity-55' : ''}`}
      style={
        popular
          ? {
              backgroundImage:
                'linear-gradient(135deg, rgba(155, 196, 255, 0.22), rgba(155, 196, 255, 0.06) 45%, transparent 75%)',
            }
          : undefined
      }
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          className="text-fg-muted text-lg font-medium"
          style={{ letterSpacing: '-0.18px' }}
        >
          {name}
        </h2>
        {popular && popularLabel ? (
          <span className="rounded-md bg-[#9bc4ff] px-1.5 py-px text-[10px] font-medium text-[#021a3f]">
            {popularLabel}
          </span>
        ) : disabled && disabledLabel ? (
          <span className="border-border-base text-fg-muted rounded-md border px-1.5 py-px text-[10px] font-medium">
            {disabledLabel}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <span
          className="text-fg-base text-4xl font-medium md:text-[48px]"
          style={{ letterSpacing: '-2px', lineHeight: 1.05 }}
        >
          {price}
        </span>
        <span className="text-fg-muted min-h-[1.25rem] text-sm">
          {priceSuffix}
        </span>
        {priceFootnote !== undefined ? (
          <span className="text-fg-muted min-h-[1lh] text-xs">
            {priceFootnote}
          </span>
        ) : null}
      </div>

      {tagline !== undefined && tagline !== null ? (
        <p
          className="text-fg-muted min-h-[4.5em] text-base"
          style={{ letterSpacing: '-0.24px', lineHeight: 1.5 }}
        >
          {tagline}
        </p>
      ) : null}

      {children}
    </motion.article>
  );
}
