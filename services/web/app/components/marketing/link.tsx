import { cn } from '@tale/ui/cn';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';

import {
  LocalizedLink,
  type LocalizedRoutePath,
} from '@/app/components/layout/localized-link';

export const marketingLinkVariants = cva('', {
  variants: {
    tone: {
      nav: 'text-fg-muted hover:text-fg-base text-[13px] font-normal tracking-tight transition-colors',
      navMobile:
        'text-fg-base text-2xl font-normal tracking-tight transition-colors',
      footer: 'text-fg-muted hover:text-fg-base text-sm transition-colors',
      inline:
        'text-fg-base underline-offset-4 transition-colors hover:underline',
      subtle:
        'text-fg-muted hover:text-fg-base text-sm underline-offset-4 transition-colors hover:underline',
      plain: '',
    },
  },
  defaultVariants: {
    tone: 'inline',
  },
});

type LocalizedLinkProps = ComponentProps<typeof LocalizedLink>;

export interface MarketingLinkProps
  extends
    Omit<LocalizedLinkProps, 'to' | 'className' | 'children'>,
    VariantProps<typeof marketingLinkVariants> {
  to: LocalizedRoutePath;
  className?: string;
  children: ReactNode;
  /** When true, applies `aria-current` styling via activeProps. */
  active?: boolean;
}

/**
 * Locale-aware marketing link with shared tone classes.
 * Routing stays in `LocalizedLink`; this owns the visual vocabulary.
 */
export function MarketingLink({
  to,
  tone = 'inline',
  className,
  active = false,
  children,
  ...rest
}: MarketingLinkProps) {
  const classes = cn(marketingLinkVariants({ tone }), className);
  return (
    <LocalizedLink
      to={to}
      className={classes}
      activeProps={
        active
          ? {
              className: cn(
                marketingLinkVariants({ tone }),
                'text-fg-base',
                className,
              ),
            }
          : undefined
      }
      {...rest}
    >
      {children}
    </LocalizedLink>
  );
}
