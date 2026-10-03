import { cn } from '@tale/ui/cn';
import { cva, type VariantProps } from 'class-variance-authority';
import type { CSSProperties, ElementType, ReactNode } from 'react';

import { Reveal } from './reveal';

const sectionHeadingTitleVariants = cva(
  'text-fg-base max-w-full font-medium text-balance [overflow-wrap:anywhere]',
  {
    variants: {
      size: {
        display: 'text-site-display tracking-[-0.055em]',
        section: 'text-site-section tracking-[-0.045em]',
        subsection: 'text-site-subsection tracking-[-0.04em]',
      },
    },
    defaultVariants: {
      size: 'section',
    },
  },
);

const sectionHeadingDescriptionVariants = cva('text-fg-muted', {
  variants: {
    size: {
      display: 'max-w-155 text-[17px] text-pretty md:text-xl',
      section: 'max-w-140 text-[17px] text-pretty md:text-lg',
      subsection: 'max-w-125 text-base md:text-lg',
    },
  },
  defaultVariants: {
    size: 'section',
  },
});

const sectionHeadingAlignVariants = cva('flex flex-col gap-4 md:gap-5', {
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
  display: 1.04,
  section: 1.08,
  subsection: 1.1,
};

interface SectionHeadingProps extends VariantProps<
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
        <p className="text-fg-muted flex items-center gap-3 text-xs font-medium tracking-[0.08em] before:h-px before:w-6 before:bg-current">
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
