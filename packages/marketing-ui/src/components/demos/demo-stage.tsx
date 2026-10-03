import { cn } from '@tale/ui/cn';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

import { useSkipEntrance } from '../../lib/entrance';
import { MARKETING_EASE } from '../marketing/reveal';

interface DemoStageProps {
  children: ReactNode;
  className?: string;
  /**
   * `hero` is the inset homepage stage with more breathing room.
   * `section` is the quieter inset used under tour rows.
   */
  variant?: 'hero' | 'section';
}

/**
 * Inset product stage with a fine grid and a one-time accent-line reveal.
 * The named query container lets scenes adapt to the stage's available
 * width. Layers live in globals.css; the window itself stays still.
 */
export function DemoStage({
  children,
  className,
  variant = 'section',
}: DemoStageProps) {
  const isHero = variant === 'hero';
  const skipEntrance = useSkipEntrance();

  return (
    <div
      className={cn(
        'bg-surface-wash border-border-base @container/demo relative isolate overflow-hidden border',
        isHero
          ? 'rounded-2xl px-2.5 py-8 sm:rounded-3xl sm:px-8 sm:py-12 lg:px-14 lg:py-16'
          : 'rounded-2xl p-2.5 sm:p-5 lg:p-7',
        className,
      )}
    >
      {/* Soft stone bloom — keeps the stage alive without a photo. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0',
          isHero ? 'bg-demo-stage-bloom-hero' : 'bg-demo-stage-bloom-section',
        )}
      />
      {/* Secondary stone bloom for depth. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 opacity-70',
          isHero ? 'bg-demo-stage-warm-hero' : 'bg-demo-stage-warm-section',
        )}
      />
      {/* Warm vignette so the window edges fall off into the wash. */}
      <div
        aria-hidden
        className="bg-demo-stage-vignette pointer-events-none absolute inset-0"
      />
      {/* Fine grid — editorial-technical texture, not a dashboard. */}
      <div
        aria-hidden
        className={cn(
          'bg-demo-stage-grid pointer-events-none absolute inset-0',
          isHero ? 'bg-demo-stage-grid-hero' : 'bg-demo-stage-grid-section',
        )}
      />
      <motion.div
        aria-hidden
        className="bg-brand-base/40 pointer-events-none absolute top-0 right-8 left-8 h-px origin-left"
        initial={skipEntrance ? false : { scaleX: 0, opacity: 0 }}
        whileInView={{ scaleX: 1, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: skipEntrance ? 0 : 0.9, ease: MARKETING_EASE }}
      />
      <div
        className={cn(
          'relative mx-auto',
          isHero ? 'max-w-5xl md:max-w-6xl' : 'max-w-none',
        )}
      >
        {children}
      </div>
    </div>
  );
}
