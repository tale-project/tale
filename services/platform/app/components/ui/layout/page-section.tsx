'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

import { SectionHeader } from './section-header';

const sectionVariants = cva('flex flex-col', {
  variants: {
    gap: {
      3: 'gap-3',
      4: 'gap-4',
      5: 'gap-5',
      6: 'gap-6',
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
