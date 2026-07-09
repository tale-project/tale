import { cn } from '@tale/ui/cn';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';

import { ExternalLink } from '@/app/components/layout/external-link';

const marketingExternalLinkVariants = cva('', {
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
