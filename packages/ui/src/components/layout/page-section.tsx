'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { gapScale } from './layout';
import { SectionHeader } from './section-header';

const sectionVariants = cva('flex flex-col', {
  variants: {
    // Subset of the shared `gapScale` so titled sections never drift from the
    // one spacing scale. Surface stays 3|4|5|6 (default 4) for back-compat.
    gap: {
      3: gapScale[3],
      4: gapScale[4],
      5: gapScale[5],
      6: gapScale[6],
    },
  },
  defaultVariants: {
    gap: 4,
  },
});

interface PageSectionProps
  extends
    Omit<HTMLAttributes<HTMLElement>, 'title'>,
    VariantProps<typeof sectionVariants> {
  /** Section heading title */
  title: ReactNode;
  /** Optional description below the title */
  description?: ReactNode;
  /** Heading level (default: h2) */
  as?: 'h2' | 'h3' | 'h4';
  /** Title size variant */
  titleSize?: 'sm' | 'base' | 'lg';
  /** Title weight variant */
  titleWeight?: 'semibold' | 'medium';
  /** Optional action element in the header */
  action?: ReactNode;
  children?: ReactNode;
}

export const PageSection = forwardRef<HTMLElement, PageSectionProps>(
  (
    {
      title,
      description,
      as,
      titleSize,
      titleWeight,
      action,
      gap,
      children,
      className,
      ...props
    },
    ref,
  ) => (
    <section
      ref={ref}
      className={cn(sectionVariants({ gap }), className)}
      {...props}
    >
      <SectionHeader
        title={title}
        description={description}
        as={as}
        size={titleSize}
        weight={titleWeight}
        action={action}
      />
      {children}
    </section>
  ),
);
PageSection.displayName = 'PageSection';
