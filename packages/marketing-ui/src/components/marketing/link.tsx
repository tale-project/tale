import { cn } from '@tale/ui/cn';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';

import {
  type MarketingLinkComponentProps,
  useMarketingLink,
} from '../../routing';

const marketingLinkVariants = cva(
  'focus-visible:outline-fg-base rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 motion-reduce:transition-none',
  {
    variants: {
      tone: {
        nav: 'text-fg-muted hover:text-fg-base text-[13px] font-normal tracking-tight transition-colors',
        navMobile:
          'text-fg-base flex min-h-11 items-center text-2xl font-medium tracking-tight transition-colors',
        footer:
          'text-fg-muted hover:text-fg-base inline-flex min-h-11 items-center text-sm transition-colors sm:min-h-8',
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
  },
);

export interface MarketingLinkProps
  extends
    Omit<MarketingLinkComponentProps, 'to' | 'className' | 'children'>,
    VariantProps<typeof marketingLinkVariants> {
  /** Site path — the host's link component (see `MarketingRouterProvider`) turns it into a URL. */
  to: string;
  className?: string;
  children: ReactNode;
  /** When true, applies `aria-current` styling via activeProps. */
  active?: boolean;
}

/**
 * Internal marketing link with the shared tone classes. Routing is the
 * host's: the link renders through the component `MarketingRouterProvider`
 * injected (TanStack `Link` by default); this owns the visual vocabulary.
 */
export function MarketingLink({
  to,
  tone = 'inline',
  className,
  active = false,
  children,
  ...rest
}: MarketingLinkProps) {
  const LinkComponent = useMarketingLink();
  const classes = cn(marketingLinkVariants({ tone }), className);
  return (
    <LinkComponent
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
    </LinkComponent>
  );
}
