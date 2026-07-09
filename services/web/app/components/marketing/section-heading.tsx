import { cn } from '@tale/ui/cn';
import { cva, type VariantProps } from 'class-variance-authority';
import type { CSSProperties, ElementType, ReactNode } from 'react';

import { Reveal } from '@/app/components/marketing/reveal';

export const sectionHeadingTitleVariants = cva('text-fg-base font-normal', {
  variants: {
    size: {
      display:
        'text-[44px] tracking-[-0.045em] md:text-[80px] md:tracking-[-0.05em]',
      section:
        'text-4xl tracking-[-0.045em] md:text-[64px] md:tracking-[-0.05em]',
      subsection:
        'text-3xl tracking-[-0.04em] md:text-[48px] md:tracking-[-0.045em]',
    },
  },
  defaultVariants: {
    size: 'section',
  },
});

export const sectionHeadingDescriptionVariants = cva('text-fg-muted', {
  variants: {
    size: {
      display: 'max-w-155 text-[17px] text-balance md:text-xl',
      section: 'max-w-140 text-[17px] md:text-xl',
      subsection: 'max-w-125 text-base md:text-lg',
    },
  },
  defaultVariants: {
    size: 'section',
  },
});

export const sectionHeadingAlignVariants = cva('flex flex-col gap-4 md:gap-5', {
  variants: {
    align: {
      center: 'items-center text-center',
      start: 'items-start text-left',
    },
  },
  defaultVariants: {
    align: 'center',
  },
});

const TITLE_LH: Record<
  NonNullable<VariantProps<typeof sectionHeadingTitleVariants>['size']>,
  number
> = {
  display: 1.02,
  section: 1.02,
  subsection: 1.05,
};

export interface SectionHeadingProps extends VariantProps<
  typeof sectionHeadingTitleVariants
> {
  title: ReactNode;
  description?: ReactNode;
  /** Optional eyebrow above the title (e.g. "01 Agents"). */
  eyebrow?: ReactNode;
  /**
   * Heading element. Defaults: `display` → h1, `section`/`subsection` → h2.
   * Pass `as="h3"` only when nesting under an existing h2.
   */
  as?: ElementType;
  align?: NonNullable<
    VariantProps<typeof sectionHeadingAlignVariants>['align']
  >;
  className?: string;
  descriptionClassName?: string;
  /** Skip the shared Reveal wrapper (caller owns motion). */
  bare?: boolean;
}

/**
 * Shared marketing heading block — title + optional eyebrow/description.
 * Use on every marketing page so type scale and tracking stay consistent.
 */
export function SectionHeading({
  title,
  description,
  eyebrow,
  size = 'section',
  as,
  align = 'center',
  className,
  descriptionClassName,
  bare = false,
}: SectionHeadingProps) {
  // subsection is a type scale, not an outline level — default to h2 so
  // pages that lead with a display h1 don't skip a level.
  const HeadingTag: ElementType = as ?? (size === 'display' ? 'h1' : 'h2');
  const resolvedSize = size ?? 'section';

  const body = (
    <div className={cn(sectionHeadingAlignVariants({ align }), className)}>
      {eyebrow ? (
        <p className="text-fg-subtle text-[13px] font-normal tracking-[0.02em]">
          {eyebrow}
        </p>
      ) : null}
      <HeadingTag
        className={sectionHeadingTitleVariants({ size: resolvedSize })}
        style={{ lineHeight: TITLE_LH[resolvedSize] } satisfies CSSProperties}
      >
        {title}
      </HeadingTag>
      {description ? (
        <p
          className={cn(
            sectionHeadingDescriptionVariants({ size: resolvedSize }),
            descriptionClassName,
          )}
          style={{ letterSpacing: '-0.015em', lineHeight: 1.5 }}
        >
          {description}
        </p>
      ) : null}
    </div>
  );

  if (bare) return body;
  return <Reveal>{body}</Reveal>;
}
