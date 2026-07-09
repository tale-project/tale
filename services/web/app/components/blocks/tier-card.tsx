import { cn } from '@tale/ui/cn';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

import {
  MARKETING_EASE,
  MARKETING_VIEWPORT,
} from '@/app/components/marketing/reveal';
import { useSkipEntrance } from '@/lib/motion/entrance';

interface TierCardProps {
  /** Tier display name (e.g. "Community", "Pro", "Quality"). */
  name: ReactNode;
  /** Highlight this tier as the recommended one (popular badge). */
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
   * tagline. The wrapping article uses `flex flex-col gap-5` so each
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
 * Pricing/hardware tier card — flat raised surface, hairline only.
 * The non-recommended tier gets a quiet frosted wash (`backdrop-blur` +
 * translucent inset); the recommended tier stays crisp raised white so
 * Free / Community reads soft and Enterprise / popular reads clear.
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
  const skipEntrance = useSkipEntrance();
  // Opacity-only — y-shifts on tier cards fight scroll on pricing pages.
  const fadeInitial = skipEntrance ? false : { opacity: 0 };

  return (
    <motion.article
      aria-disabled={disabled || undefined}
      initial={fadeInitial}
      whileInView={{ opacity: 1 }}
      viewport={MARKETING_VIEWPORT}
      transition={
        skipEntrance
          ? { duration: 0 }
          : { duration: 0.5, delay: animationDelay, ease: MARKETING_EASE }
      }
      className={cn(
        'relative flex h-full flex-col gap-5 rounded-2xl border p-6 sm:p-8',
        popular
          ? 'border-border-base/40 bg-surface-site-raised'
          : 'border-border-base/50 bg-surface-site-inset/40 backdrop-blur-md',
        disabled && 'opacity-55',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-fg-base text-xl font-medium tracking-tight">
          {name}
        </h2>
        {popular && popularLabel ? (
          <span className="bg-surface-site-raised/70 text-fg-muted shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-tight backdrop-blur-sm">
            {popularLabel}
          </span>
        ) : disabled && disabledLabel ? (
          <span className="text-fg-muted shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tracking-tight">
            {disabledLabel}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-fg-base text-4xl font-medium tracking-[-0.04em] md:text-[48px] md:leading-[1.05]">
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
        <p className="text-fg-muted min-h-[3em] text-base leading-normal tracking-tight">
          {tagline}
        </p>
      ) : null}

      {children}
    </motion.article>
  );
}
