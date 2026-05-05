import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

const easeOut = [0.22, 1, 0.36, 1] as const;

export interface TierCardProps {
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
  tagline,
  children,
  animationDelay = 0,
}: TierCardProps) {
  const reduceMotion = useReducedMotion();
  const fadeInitial = reduceMotion ? false : { opacity: 0, y: 24 };

  return (
    <motion.article
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
      }`}
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
          {priceSuffix ? priceSuffix : ' '}
        </span>
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
