import { cn } from '@tale/ui/cn';
import { ExternalLink } from '@tale/ui/external-link';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';

const marketingExternalLinkVariants = cva(
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

type ExternalLinkProps = ComponentProps<typeof ExternalLink>;

interface MarketingExternalLinkProps
  extends
    Omit<ExternalLinkProps, 'className' | 'children'>,
    VariantProps<typeof marketingExternalLinkVariants> {
  className?: string;
  children: ReactNode;
}

/** Outbound marketing link with the same tone scale as `MarketingLink`. */
export function MarketingExternalLink({
  tone = 'inline',
  className,
  children,
  showIcon,
  ...rest
}: MarketingExternalLinkProps) {
  return (
    <ExternalLink
      className={cn(marketingExternalLinkVariants({ tone }), className)}
      showIcon={showIcon}
      {...rest}
    >
      {children}
    </ExternalLink>
  );
}
