import { cn } from '@tale/ui/cn';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';

const marketingStackVariants = cva('mx-auto flex w-full flex-col', {
  variants: {
    gap: {
      sm: 'gap-4 md:gap-5',
      md: 'gap-8 md:gap-10',
      lg: 'gap-10 md:gap-12',
      xl: 'gap-12',
    },
    align: {
      center: 'items-center text-center',
      start: 'items-start text-left',
      stretch: 'items-stretch',
    },
    max: {
      sm: 'max-w-2xl',
      md: 'max-w-3xl',
      lg: 'max-w-4xl',
      xl: 'max-w-5xl',
      full: 'max-w-none',
    },
  },
  defaultVariants: {
    gap: 'md',
    align: 'center',
    max: 'lg',
  },
});

interface MarketingStackProps extends VariantProps<
  typeof marketingStackVariants
> {
  children: ReactNode;
  className?: string;
}

/**
 * Vertical content column used inside page sections (hero, CTA band, FAQ).
 */
export function MarketingStack({
  children,
  gap = 'md',
  align = 'center',
  max = 'lg',
  className,
}: MarketingStackProps) {
  return (
    <div className={cn(marketingStackVariants({ gap, align, max }), className)}>
      {children}
    </div>
  );
}
