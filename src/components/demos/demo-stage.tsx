import { cn } from '@tale/ui/cn';
import type { ReactNode } from 'react';

interface DemoStageProps {
  children: ReactNode;
  className?: string;
  /**
   * `hero` is the full-bleed homepage stage with a deeper glow.
   * `section` is the quieter inset used under tour rows.
   */
  variant?: 'hero' | 'section';
}

/**
 * Atmospheric stage under product demo windows — stone wash, soft radial
 * glow, and a faint grid so the shell reads as a product surface on a
 * band. Layers live in globals.css (`bg-demo-stage-*`). No continuous
 * transform animation — that fights scroll.
 */
export function DemoStage({
  children,
  className,
  variant = 'section',
}: DemoStageProps) {
  const isHero = variant === 'hero';

  return (
    <div
      className={cn(
        'bg-surface-wash relative overflow-hidden',
        isHero
          ? 'border-border-base/50 border-y px-3 py-12 sm:px-10 sm:py-16 md:px-16 md:py-24'
          : 'border-border-base/70 rounded-2xl border p-3 sm:p-5 md:rounded-3xl md:p-8',
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
