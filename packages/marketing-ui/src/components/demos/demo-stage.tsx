import { cn } from '@tale/ui/cn';
import type { ReactNode } from 'react';

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
 * Inset product stage with a domain-specific palette and technical texture.
 * The named query container lets scenes adapt to the stage's available
 * width. Layers live in globals.css; the window itself stays still.
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
        'demo-stage border-border-base @container/demo relative isolate overflow-hidden border',
        isHero
          ? 'rounded-2xl px-2.5 py-6 sm:rounded-3xl sm:px-7 sm:py-9 lg:px-10 lg:py-12'
          : 'rounded-2xl p-2 sm:p-3 lg:p-4',
        className,
      )}
    >
      {/* A quiet drafting texture, shaped by the product scene inside. */}
      <div
        aria-hidden
        className="demo-stage-texture pointer-events-none absolute inset-0"
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
