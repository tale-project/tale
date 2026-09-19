import { cn } from '@tale/ui/cn';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { MarketingButton } from './button';
import { MarketingExternalLink } from './external-link';
import { MarketingLink } from './link';

const ctaGroupVariants = cva('flex flex-wrap items-center gap-3', {
  variants: {
    align: {
      center: 'justify-center',
      start: 'justify-start',
    },
  },
  defaultVariants: {
    align: 'center',
  },
});

interface CtaGroupProps extends VariantProps<typeof ctaGroupVariants> {
  children?: ReactNode;
  className?: string;
}

/** Horizontal CTA row used under heroes and closing bands. */
function CtaGroup({ children, className, align = 'center' }: CtaGroupProps) {
  return (
    <div className={cn(ctaGroupVariants({ align }), className)}>{children}</div>
  );
}

export interface CtaAction {
  label: ReactNode;
  /** Internal site path (rendered through the host's link component). */
  to?: string;
  /** External URL (docs, GitHub, …). */
  href?: string;
}

export interface CtaPairProps {
  primary: CtaAction;
  secondary: CtaAction;
  size?: 'default' | 'lg';
  className?: string;
  align?: 'center' | 'start';
}

function CtaActionButton({
  action,
  tone,
  size,
}: {
  action: CtaAction;
  tone: 'primary' | 'secondary';
  size: 'default' | 'lg';
}) {
  if (action.href) {
    return (
      <MarketingButton asChild tone={tone} size={size}>
        <MarketingExternalLink href={action.href} tone="plain" showIcon={false}>
          {action.label}
        </MarketingExternalLink>
      </MarketingButton>
    );
  }
  if (action.to) {
    return (
      <MarketingButton asChild tone={tone} size={size}>
        <MarketingLink to={action.to} tone="plain">
          {action.label}
        </MarketingLink>
      </MarketingButton>
    );
  }
  return null;
}

/**
 * Standard two-CTA pair. First action is ink primary; second is inset.
 * Either side may be an internal `to` or external `href`.
 */
export function CtaPair({
  primary,
  secondary,
  size = 'lg',
  className,
  align = 'center',
}: CtaPairProps) {
  return (
    <CtaGroup className={className} align={align}>
      <CtaActionButton action={primary} tone="primary" size={size} />
      <CtaActionButton action={secondary} tone="secondary" size={size} />
    </CtaGroup>
  );
}
