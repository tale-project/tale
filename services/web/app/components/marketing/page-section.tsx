import { cn } from '@tale/ui/cn';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { SiteContainer } from '@/app/components/layout/site-container';

export const pageSectionVariants = cva('', {
  variants: {
    surface: {
      site: 'bg-surface-site',
      wash: 'bg-surface-wash',
      soft: 'bg-gradient-site-band',
      plain: '',
      transparent: 'bg-transparent',
    },
    pad: {
      md: 'py-12 md:py-16',
      lg: 'py-16 md:py-20',
      xl: 'py-20 md:py-28',
    },
    border: {
      none: '',
      b: 'border-border-base border-b',
      t: 'border-border-base border-t',
      y: 'border-border-base border-y',
    },
  },
  defaultVariants: {
    surface: 'plain',
    pad: 'lg',
    border: 'b',
  },
});

export interface PageSectionProps extends VariantProps<
  typeof pageSectionVariants
> {
  children: ReactNode;
  /** Skip the inner `SiteContainer` (caller owns width). */
  bare?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
  containerClassName?: string;
}

/**
 * Page band chrome — surface, padding, border, optional SiteContainer.
 * Compose with `SectionHeading` / `CtaGroup` / cards inside.
 * For pricing lead/subsection shells, keep using `MarketingSection` in blocks
 * (lead matches `FeatureHero` heading chrome).
 *
 * Top-of-page atmosphere (`bg-gradient-site-hero`) lives on the root shell so
 * the sticky transparent header always sits on the wash. Lead sections stay
 * transparent — re-painting the same class under the nav restarts the wash
 * and reads as a hairline seam.
 */
export function PageSection({
  children,
  surface = 'plain',
  pad = 'lg',
  border = 'b',
  bare = false,
  id,
  'aria-label': ariaLabel,
  className,
  containerClassName,
}: PageSectionProps) {
  const body = bare ? (
    children
  ) : (
    <SiteContainer className={containerClassName}>{children}</SiteContainer>
  );

  return (
    <section
      id={id}
      aria-label={ariaLabel}
      className={cn(pageSectionVariants({ surface, pad, border }), className)}
    >
      {body}
    </section>
  );
}
